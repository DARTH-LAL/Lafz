import type { AiArtistMemory, AiTranslationDraftFile } from "@/features/ai/types";
import { getAiArtistMemory } from "@/features/ai/artist-memory";
import { getAiTranslationDraftByTrackId } from "@/features/ai/repository";
import { enqueuePersonaAgentJob } from "@/features/brain/agent-jobs";
import { recordMotifClaimsIntoLafzBrain } from "@/features/brain/claims";
import {
  enqueueMotifBacklogBatch,
  getMotifBacklogRefillCooldownMs,
  hasActiveMotifAgentJobs,
  isMotifBacklogAutoRefillEnabled
} from "@/features/brain/motif-backlog";
import {
  claimNextAgentJob,
  heartbeatAgentJob,
  insertAgentRun,
  readAgentJobByKey,
  updateAgentJobStatus,
  updateAgentRun
} from "@/features/brain/repository";
import { splitArtistCredits } from "@/features/brain/normalize";
import { getSupabaseServerClient } from "@/features/cloud/supabase";

const DEFAULT_MOTIF_AGENT_POLL_MS = 15_000;
const DEFAULT_MOTIF_AGENT_MAX_ATTEMPTS = 3;
const DEFAULT_MOTIF_AGENT_RETRY_BASE_MS = 30_000;
const DEFAULT_MOTIF_AGENT_RETRY_MAX_MS = 10 * 60_000;
const DEFAULT_MOTIF_AGENT_STALE_JOB_TIMEOUT_MS = 15 * 60_000;

export type MotifAgentRuntimeMode = "disabled" | "embedded" | "standalone";

type MotifArtistContext = {
  artistKey: string;
  displayName: string;
  memory: AiArtistMemory | null;
};

type MotifAgentRunSummary = {
  jobId: string;
  jobKey: string;
  spotifyTrackId: string;
  claimsUpserted: number;
  evidencesInserted: number;
  promotionsRecorded: number;
  artistsProcessed: number;
};

type MotifAgentGlobals = typeof globalThis & {
  __lafzMotifAgentInterval?: NodeJS.Timeout;
  __lafzMotifAgentInFlight?: Promise<void> | null;
  __lafzMotifAgentStartedAt?: string;
  __lafzMotifAgentLastKickReason?: string | null;
  __lafzMotifAgentLastActivityAt?: string | null;
  __lafzMotifAgentLastSummary?: MotifAgentRunSummary | null;
  __lafzMotifAgentLastBacklogRefillAt?: string | null;
  __lafzMotifAgentLastBacklogRefillResult?: {
    enqueued: number;
    candidatesFound: number;
    exhausted: boolean;
    sampleJobKeys: string[];
  } | null;
};

type StaleMotifAgentJobRow = {
  id: string;
  job_key: string;
  attempt_count: number;
  claimed_by: string | null;
  claimed_at: string | null;
  last_heartbeat_at: string | null;
};

function getMotifAgentGlobals() {
  return globalThis as MotifAgentGlobals;
}

export function getMotifAgentRuntimeMode(): MotifAgentRuntimeMode {
  const explicitMode = process.env.LAFZ_AGENT_RUNTIME_MODE?.trim().toLowerCase();

  if (explicitMode === "embedded" || explicitMode === "standalone" || explicitMode === "disabled") {
    return explicitMode;
  }

  if (process.env.LAFZ_AGENT_WORKER_ENABLED?.trim().toLowerCase() === "true") {
    return "embedded";
  }

  return "disabled";
}

function isMotifAgentEmbeddedMode() {
  return getMotifAgentRuntimeMode() === "embedded";
}

function getMotifAgentWorkerId(fallbackPrefix = "lafz-motif-worker") {
  return process.env.LAFZ_MOTIF_AGENT_WORKER_ID?.trim() || `${fallbackPrefix}-${process.pid}`;
}

function getMotifAgentPollMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_WORKER_POLL_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MOTIF_AGENT_POLL_MS;
}

function getMotifAgentMaxAttempts() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_MAX_ATTEMPTS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MOTIF_AGENT_MAX_ATTEMPTS;
}

function getMotifAgentRetryBaseMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_RETRY_BASE_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MOTIF_AGENT_RETRY_BASE_MS;
}

function getMotifAgentRetryMaxMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_RETRY_MAX_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MOTIF_AGENT_RETRY_MAX_MS;
}

function getMotifAgentStaleJobTimeoutMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_STALE_JOB_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MOTIF_AGENT_STALE_JOB_TIMEOUT_MS;
}

function computeMotifAgentRetryDelayMs(attemptCount: number) {
  const retryIndex = Math.max(0, attemptCount - 1);
  const delay = getMotifAgentRetryBaseMs() * 2 ** retryIndex;
  return Math.min(delay, getMotifAgentRetryMaxMs());
}

async function loadMotifArtistContexts(draftFile: AiTranslationDraftFile) {
  const credits = splitArtistCredits(draftFile.artist);
  const contexts: MotifArtistContext[] = [];

  for (const credit of credits) {
    const { memory } = await getAiArtistMemory(credit.name).catch(() => ({ memory: null }));

    contexts.push({
      artistKey: credit.key,
      displayName: memory?.displayName ?? credit.name,
      memory
    });
  }

  if (contexts.length === 0 && draftFile.artistMemory) {
    contexts.push({
      artistKey: draftFile.artistMemory.artistKey,
      displayName: draftFile.artistMemory.displayName,
      memory: draftFile.artistMemory
    });
  }

  return contexts;
}

function isStaleMotifAgentJob(row: StaleMotifAgentJobRow, timeoutMs: number) {
  const heartbeatAt = row.last_heartbeat_at ?? row.claimed_at;

  if (!heartbeatAt) {
    return false;
  }

  const heartbeatTime = new Date(heartbeatAt).getTime();

  if (!Number.isFinite(heartbeatTime)) {
    return false;
  }

  return Date.now() - heartbeatTime >= timeoutMs;
}

async function reclaimStaleMotifAgentJobs() {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return { reclaimed: 0, deadLettered: 0, sampleJobKeys: [] as string[] };
  }

  const timeoutMs = getMotifAgentStaleJobTimeoutMs();
  const maxAttempts = getMotifAgentMaxAttempts();
  const { data, error } = await supabase
    .from("agent_jobs")
    .select("id, job_key, attempt_count, claimed_by, claimed_at, last_heartbeat_at")
    .eq("job_type", "motif_agent")
    .in("status", ["claimed", "running"])
    .order("updated_at", { ascending: true })
    .limit(100);

  if (error) {
    console.error("[lafz-brain] could not scan stale motif jobs.", error);
    return { reclaimed: 0, deadLettered: 0, sampleJobKeys: [] as string[] };
  }

  const staleJobs = (data ?? [])
    .filter((row): row is StaleMotifAgentJobRow => Boolean(row && typeof row.id === "string" && typeof row.job_key === "string"))
    .filter((row) => isStaleMotifAgentJob(row, timeoutMs));

  if (staleJobs.length === 0) {
    return { reclaimed: 0, deadLettered: 0, sampleJobKeys: [] as string[] };
  }

  const now = new Date().toISOString();
  const staleMessage = `Recovered stale motif job after ${timeoutMs}ms without heartbeat.`;
  const sampleJobKeys: string[] = [];
  let reclaimed = 0;
  let deadLettered = 0;

  for (const job of staleJobs) {
    if (sampleJobKeys.length < 5) {
      sampleJobKeys.push(job.job_key);
    }

    const shouldDeadLetter = job.attempt_count >= maxAttempts;
    const nextStatus = shouldDeadLetter ? "dead_lettered" : "pending";

    const { error: jobError } = await supabase
      .from("agent_jobs")
      .update({
        status: nextStatus,
        claimed_by: null,
        claimed_at: null,
        last_heartbeat_at: shouldDeadLetter ? now : null,
        last_error: staleMessage,
        available_at: now,
        updated_at: now
      })
      .eq("id", job.id);

    if (jobError) {
      console.error("[lafz-brain] could not reclaim stale motif job.", { jobKey: job.job_key, error: jobError });
      continue;
    }

    const { error: runError } = await supabase
      .from("agent_runs")
      .update({
        status: "cancelled",
        error_text: staleMessage,
        finished_at: now,
        updated_at: now
      })
      .eq("job_id", job.id)
      .eq("agent_role", "motif_agent")
      .eq("status", "running");

    if (runError) {
      console.error("[lafz-brain] could not mark stale motif run as cancelled.", { jobKey: job.job_key, error: runError });
    }

    if (shouldDeadLetter) {
      deadLettered += 1;
    } else {
      reclaimed += 1;
    }
  }

  if (sampleJobKeys.length > 0) {
    console.log("[lafz-brain] motif stale job recovery applied.", {
      reclaimed,
      deadLettered,
      sampleJobKeys
    });
  }

  return { reclaimed, deadLettered, sampleJobKeys };
}

async function finalizeMotifAgentFailureJob(options: {
  jobId: string;
  jobKey: string;
  workerId: string;
  shouldRetry: boolean;
  nextJobStatus: "pending" | "dead_lettered";
  nextAvailableAt: string | null;
  message: string;
}) {
  const patch = {
    workerId: options.shouldRetry ? null : options.workerId,
    heartbeat: true,
    lastError: options.message,
    availableAt: options.nextAvailableAt
  } as const;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const updated = await updateAgentJobStatus(options.jobId, options.nextJobStatus, patch);

    if (updated?.status === options.nextJobStatus) {
      return updated;
    }
  }

  const observed = await readAgentJobByKey(options.jobKey);
  return observed;
}

async function processClaimedMotifAgentJob(workerId: string): Promise<MotifAgentRunSummary | null> {
  const job = await claimNextAgentJob(workerId, "motif_agent");

  if (!job) {
    return null;
  }

  const run = await insertAgentRun({
    jobId: job.id,
    agentRole: "motif_agent",
    workerId,
    input: {
      jobKey: job.jobKey,
      spotifyTrackId: job.spotifyTrackId,
      scopeKey: job.scopeKey
    }
  });

  try {
    await updateAgentJobStatus(job.id, "running", {
      workerId,
      heartbeat: true,
      lastError: null
    });

    const spotifyTrackId = job.spotifyTrackId;

    if (!spotifyTrackId) {
      throw new Error("Motif agent job is missing spotifyTrackId.");
    }

    const draftFile = await getAiTranslationDraftByTrackId(spotifyTrackId);

    if (!draftFile) {
      throw new Error(`Could not load draft for ${spotifyTrackId}.`);
    }

    const songNodeId =
      typeof job.payload.songNodeId === "string" && job.payload.songNodeId.trim().length > 0
        ? job.payload.songNodeId.trim()
        : null;

    if (!songNodeId) {
      throw new Error(`Motif agent job ${job.jobKey} is missing songNodeId.`);
    }

    const artists = await loadMotifArtistContexts(draftFile);

    await heartbeatAgentJob(job.id, workerId);

    const summary = await recordMotifClaimsIntoLafzBrain({
      draftFile,
      songNodeId,
      artists
    });

    const output = {
      claimsUpserted: summary.claimsUpserted,
      evidencesInserted: summary.evidencesInserted,
      promotionsRecorded: summary.promotionsRecorded,
      artistsProcessed: artists.length
    };

    void enqueuePersonaAgentJob({
      draftFile,
      songNodeId
    }).catch(() => {
      // Non-fatal queue side effect.
    });

    if (run) {
      await updateAgentRun(run.id, {
        status: "completed",
        output
      });
    }

    await updateAgentJobStatus(job.id, "completed", {
      workerId,
      heartbeat: true,
      lastError: null
    });

    return {
      jobId: job.id,
      jobKey: job.jobKey,
      spotifyTrackId,
      ...output
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown motif-agent error.";
    const maxAttempts = getMotifAgentMaxAttempts();
    const shouldRetry = job.attemptCount < maxAttempts;
    const retryDelayMs = shouldRetry ? computeMotifAgentRetryDelayMs(job.attemptCount) : 0;
    const nextAvailableAt = shouldRetry ? new Date(Date.now() + retryDelayMs).toISOString() : null;
    const nextJobStatus = shouldRetry ? "pending" : "dead_lettered";

    if (run) {
      await updateAgentRun(run.id, {
        status: "failed",
        errorText: message,
        output: {
          retryScheduled: shouldRetry,
          nextAttemptAt: nextAvailableAt,
          attemptCount: job.attemptCount,
          maxAttempts
        }
      });
    }

    await finalizeMotifAgentFailureJob({
      jobId: job.id,
      jobKey: job.jobKey,
      workerId,
      shouldRetry,
      nextJobStatus,
      nextAvailableAt,
      message
    });

    console.error("[lafz-brain] motif agent job failed.", {
      jobKey: job.jobKey,
      spotifyTrackId: job.spotifyTrackId,
      error: message,
      willRetry: shouldRetry,
      attemptCount: job.attemptCount,
      maxAttempts,
      nextAttemptAt: nextAvailableAt
    });

    return {
      jobId: job.id,
      jobKey: job.jobKey,
      spotifyTrackId: job.spotifyTrackId ?? "",
      claimsUpserted: 0,
      evidencesInserted: 0,
      promotionsRecorded: 0,
      artistsProcessed: 0
    };
  }
}

async function refillMotifBacklogIfIdle() {
  if (!isMotifBacklogAutoRefillEnabled()) {
    return 0;
  }

  const globals = getMotifAgentGlobals();
  const cooldownMs = getMotifBacklogRefillCooldownMs();
  const lastRefillAt = globals.__lafzMotifAgentLastBacklogRefillAt
    ? new Date(globals.__lafzMotifAgentLastBacklogRefillAt).getTime()
    : 0;

  if (Date.now() - lastRefillAt < cooldownMs) {
    return 0;
  }

  const hasActiveJobs = await hasActiveMotifAgentJobs();

  if (hasActiveJobs) {
    return 0;
  }

  const result = await enqueueMotifBacklogBatch();
  globals.__lafzMotifAgentLastBacklogRefillAt = new Date().toISOString();
  globals.__lafzMotifAgentLastBacklogRefillResult = result;

  if (result.enqueued > 0) {
    console.log("[lafz-brain] motif backlog refill queued jobs.", {
      enqueued: result.enqueued,
      candidatesFound: result.candidatesFound,
      exhausted: result.exhausted,
      sampleJobKeys: result.sampleJobKeys
    });
  }

  return result.enqueued;
}

export async function runNextMotifAgentJob(options?: {
  ignoreMode?: boolean;
  workerId?: string | null;
}) {
  if (!options?.ignoreMode && !isMotifAgentEmbeddedMode()) {
    return null;
  }

  await reclaimStaleMotifAgentJobs();

  const workerId = options?.workerId?.trim() || getMotifAgentWorkerId(options?.ignoreMode ? "lafz-standalone-motif-worker" : "lafz-motif-worker");
  const globals = getMotifAgentGlobals();
  const summary = await processClaimedMotifAgentJob(workerId);

  if (summary) {
    globals.__lafzMotifAgentLastActivityAt = new Date().toISOString();
    globals.__lafzMotifAgentLastSummary = summary;
  }

  return summary;
}

export async function runMotifAgentUntilIdle(options?: {
  ignoreMode?: boolean;
  workerId?: string | null;
  reason?: string;
  maxJobs?: number | null;
}) {
  const globals = getMotifAgentGlobals();
  const reason = options?.reason ?? "manual";
  globals.__lafzMotifAgentLastKickReason = reason;

  const processed: MotifAgentRunSummary[] = [];

  while (true) {
    if (options?.maxJobs && processed.length >= options.maxJobs) {
      break;
    }

    const summary = await runNextMotifAgentJob(options);

    if (!summary) {
      const refilled = await refillMotifBacklogIfIdle();

      if (refilled > 0) {
        continue;
      }

      break;
    }

    processed.push(summary);

    console.log("[lafz-brain] motif agent processed job.", {
      reason,
      jobKey: summary.jobKey,
      spotifyTrackId: summary.spotifyTrackId,
      claimsUpserted: summary.claimsUpserted,
      evidencesInserted: summary.evidencesInserted,
      promotionsRecorded: summary.promotionsRecorded
    });
  }

  return processed;
}

export function kickMotifAgentWorker(reason = "manual") {
  if (!isMotifAgentEmbeddedMode()) {
    return;
  }

  const globals = getMotifAgentGlobals();

  if (globals.__lafzMotifAgentInFlight) {
    return;
  }

  globals.__lafzMotifAgentInFlight = (async () => {
    try {
      await runMotifAgentUntilIdle({ reason });
    } finally {
      globals.__lafzMotifAgentInFlight = null;

      void hasActiveMotifAgentJobs()
        .then((hasActiveJobs) => {
          if (!hasActiveJobs) {
            return;
          }

          setTimeout(() => {
            kickMotifAgentWorker("drain-pending");
          }, 0);
        })
        .catch((error) => {
          console.error("[lafz-brain] motif agent could not check for pending jobs after a run.", error);
        });
    }
  })();
}

export function ensureMotifAgentWorkerStarted() {
  if (!isMotifAgentEmbeddedMode()) {
    return;
  }

  const globals = getMotifAgentGlobals();

  if (!globals.__lafzMotifAgentStartedAt) {
    globals.__lafzMotifAgentStartedAt = new Date().toISOString();
  }

  if (!globals.__lafzMotifAgentInterval) {
    globals.__lafzMotifAgentInterval = setInterval(() => {
      kickMotifAgentWorker("interval");
    }, getMotifAgentPollMs());
  }

  kickMotifAgentWorker("startup");
}

export function getMotifAgentProcessStatus() {
  const globals = getMotifAgentGlobals();

  return {
    runtimeMode: getMotifAgentRuntimeMode(),
    workerId: getMotifAgentWorkerId(),
    pollMs: getMotifAgentPollMs(),
    autoBacklogEnabled: isMotifBacklogAutoRefillEnabled(),
    staleJobTimeoutMs: getMotifAgentStaleJobTimeoutMs(),
    startedAt: globals.__lafzMotifAgentStartedAt ?? null,
    lastKickReason: globals.__lafzMotifAgentLastKickReason ?? null,
    lastActivityAt: globals.__lafzMotifAgentLastActivityAt ?? null,
    lastBacklogRefillAt: globals.__lafzMotifAgentLastBacklogRefillAt ?? null,
    lastBacklogRefillResult: globals.__lafzMotifAgentLastBacklogRefillResult ?? null,
    inFlight: Boolean(globals.__lafzMotifAgentInFlight),
    intervalActive: Boolean(globals.__lafzMotifAgentInterval),
    lastSummary: globals.__lafzMotifAgentLastSummary ?? null
  };
}
