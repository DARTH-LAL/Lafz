import type { AiArtistMemory, AiTranslationDraftFile } from "@/features/ai/types";
import { getAiArtistMemory } from "@/features/ai/artist-memory";
import { getAiTranslationDraftByTrackId } from "@/features/ai/repository";
import { enqueueCleanupAgentJob } from "@/features/brain/agent-jobs";
import { recordPersonaClaimsIntoLafzBrain } from "@/features/brain/claims";
import {
  enqueuePersonaBacklogBatch,
  getPersonaBacklogRefillCooldownMs,
  hasActivePersonaAgentJobs,
  isPersonaBacklogAutoRefillEnabled
} from "@/features/brain/persona-backlog";
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

const DEFAULT_PERSONA_AGENT_POLL_MS = 15_000;
const DEFAULT_PERSONA_AGENT_MAX_ATTEMPTS = 3;
const DEFAULT_PERSONA_AGENT_RETRY_BASE_MS = 30_000;
const DEFAULT_PERSONA_AGENT_RETRY_MAX_MS = 10 * 60_000;
const DEFAULT_PERSONA_AGENT_STALE_JOB_TIMEOUT_MS = 15 * 60_000;

export type PersonaAgentRuntimeMode = "disabled" | "embedded" | "standalone";

type PersonaArtistContext = {
  artistKey: string;
  displayName: string;
  memory: AiArtistMemory | null;
};

type PersonaAgentRunSummary = {
  jobId: string;
  jobKey: string;
  spotifyTrackId: string;
  claimsUpserted: number;
  evidencesInserted: number;
  promotionsRecorded: number;
  artistsProcessed: number;
};

type PersonaAgentGlobals = typeof globalThis & {
  __lafzPersonaAgentInterval?: NodeJS.Timeout;
  __lafzPersonaAgentInFlight?: Promise<void> | null;
  __lafzPersonaAgentStartedAt?: string;
  __lafzPersonaAgentLastKickReason?: string | null;
  __lafzPersonaAgentLastActivityAt?: string | null;
  __lafzPersonaAgentLastSummary?: PersonaAgentRunSummary | null;
  __lafzPersonaAgentLastBacklogRefillAt?: string | null;
  __lafzPersonaAgentLastBacklogRefillResult?: {
    enqueued: number;
    candidatesFound: number;
    exhausted: boolean;
    sampleJobKeys: string[];
  } | null;
};

type StalePersonaAgentJobRow = {
  id: string;
  job_key: string;
  attempt_count: number;
  claimed_by: string | null;
  claimed_at: string | null;
  last_heartbeat_at: string | null;
};

function getPersonaAgentGlobals() {
  return globalThis as PersonaAgentGlobals;
}

export function getPersonaAgentRuntimeMode(): PersonaAgentRuntimeMode {
  const explicitMode = process.env.LAFZ_AGENT_RUNTIME_MODE?.trim().toLowerCase();

  if (explicitMode === "embedded" || explicitMode === "standalone" || explicitMode === "disabled") {
    return explicitMode;
  }

  if (process.env.LAFZ_AGENT_WORKER_ENABLED?.trim().toLowerCase() === "true") {
    return "embedded";
  }

  return "disabled";
}

function isPersonaAgentEmbeddedMode() {
  return getPersonaAgentRuntimeMode() === "embedded";
}

function getPersonaAgentWorkerId(fallbackPrefix = "lafz-persona-worker") {
  return process.env.LAFZ_PERSONA_AGENT_WORKER_ID?.trim() || `${fallbackPrefix}-${process.pid}`;
}

function getPersonaAgentPollMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_WORKER_POLL_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PERSONA_AGENT_POLL_MS;
}

function getPersonaAgentMaxAttempts() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_MAX_ATTEMPTS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PERSONA_AGENT_MAX_ATTEMPTS;
}

function getPersonaAgentRetryBaseMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_RETRY_BASE_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PERSONA_AGENT_RETRY_BASE_MS;
}

function getPersonaAgentRetryMaxMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_RETRY_MAX_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PERSONA_AGENT_RETRY_MAX_MS;
}

function getPersonaAgentStaleJobTimeoutMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_STALE_JOB_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PERSONA_AGENT_STALE_JOB_TIMEOUT_MS;
}

function computePersonaAgentRetryDelayMs(attemptCount: number) {
  const retryIndex = Math.max(0, attemptCount - 1);
  const delay = getPersonaAgentRetryBaseMs() * 2 ** retryIndex;
  return Math.min(delay, getPersonaAgentRetryMaxMs());
}

async function loadPersonaArtistContexts(draftFile: AiTranslationDraftFile) {
  const credits = splitArtistCredits(draftFile.artist).slice(0, 1);
  const contexts: PersonaArtistContext[] = [];

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

function isStalePersonaAgentJob(row: StalePersonaAgentJobRow, timeoutMs: number) {
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

async function reclaimStalePersonaAgentJobs() {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return { reclaimed: 0, deadLettered: 0, sampleJobKeys: [] as string[] };
  }

  const timeoutMs = getPersonaAgentStaleJobTimeoutMs();
  const maxAttempts = getPersonaAgentMaxAttempts();
  const { data, error } = await supabase
    .from("agent_jobs")
    .select("id, job_key, attempt_count, claimed_by, claimed_at, last_heartbeat_at")
    .eq("job_type", "persona_agent")
    .in("status", ["claimed", "running"])
    .order("updated_at", { ascending: true })
    .limit(100);

  if (error) {
    console.error("[lafz-brain] could not scan stale persona jobs.", error);
    return { reclaimed: 0, deadLettered: 0, sampleJobKeys: [] as string[] };
  }

  const staleJobs = (data ?? [])
    .filter((row): row is StalePersonaAgentJobRow => Boolean(row && typeof row.id === "string" && typeof row.job_key === "string"))
    .filter((row) => isStalePersonaAgentJob(row, timeoutMs));

  if (staleJobs.length === 0) {
    return { reclaimed: 0, deadLettered: 0, sampleJobKeys: [] as string[] };
  }

  const now = new Date().toISOString();
  const staleMessage = `Recovered stale persona job after ${timeoutMs}ms without heartbeat.`;
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
      console.error("[lafz-brain] could not reclaim stale persona job.", { jobKey: job.job_key, error: jobError });
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
      .eq("agent_role", "persona_agent")
      .eq("status", "running");

    if (runError) {
      console.error("[lafz-brain] could not mark stale persona run as cancelled.", { jobKey: job.job_key, error: runError });
    }

    if (shouldDeadLetter) {
      deadLettered += 1;
    } else {
      reclaimed += 1;
    }
  }

  if (sampleJobKeys.length > 0) {
    console.log("[lafz-brain] persona stale job recovery applied.", {
      reclaimed,
      deadLettered,
      sampleJobKeys
    });
  }

  return { reclaimed, deadLettered, sampleJobKeys };
}

async function finalizePersonaAgentFailureJob(options: {
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

async function processClaimedPersonaAgentJob(workerId: string): Promise<PersonaAgentRunSummary | null> {
  const job = await claimNextAgentJob(workerId, "persona_agent");

  if (!job) {
    return null;
  }

  const run = await insertAgentRun({
    jobId: job.id,
    agentRole: "persona_agent",
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
      throw new Error("Persona agent job is missing spotifyTrackId.");
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
      throw new Error(`Persona agent job ${job.jobKey} is missing songNodeId.`);
    }

    const artists = await loadPersonaArtistContexts(draftFile);

    await heartbeatAgentJob(job.id, workerId);

    const summary = await recordPersonaClaimsIntoLafzBrain({
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

    void enqueueCleanupAgentJob({
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
    const message = error instanceof Error ? error.message : "Unknown persona-agent error.";
    const maxAttempts = getPersonaAgentMaxAttempts();
    const shouldRetry = job.attemptCount < maxAttempts;
    const retryDelayMs = shouldRetry ? computePersonaAgentRetryDelayMs(job.attemptCount) : 0;
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

    await finalizePersonaAgentFailureJob({
      jobId: job.id,
      jobKey: job.jobKey,
      workerId,
      shouldRetry,
      nextJobStatus,
      nextAvailableAt,
      message
    });

    console.error("[lafz-brain] persona agent job failed.", {
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

async function refillPersonaBacklogIfIdle() {
  if (!isPersonaBacklogAutoRefillEnabled()) {
    return 0;
  }

  const globals = getPersonaAgentGlobals();
  const cooldownMs = getPersonaBacklogRefillCooldownMs();
  const lastRefillAt = globals.__lafzPersonaAgentLastBacklogRefillAt
    ? new Date(globals.__lafzPersonaAgentLastBacklogRefillAt).getTime()
    : 0;

  if (Date.now() - lastRefillAt < cooldownMs) {
    return 0;
  }

  const hasActiveJobs = await hasActivePersonaAgentJobs();

  if (hasActiveJobs) {
    return 0;
  }

  const result = await enqueuePersonaBacklogBatch();
  globals.__lafzPersonaAgentLastBacklogRefillAt = new Date().toISOString();
  globals.__lafzPersonaAgentLastBacklogRefillResult = result;

  if (result.enqueued > 0) {
    console.log("[lafz-brain] persona backlog refill queued jobs.", {
      enqueued: result.enqueued,
      candidatesFound: result.candidatesFound,
      exhausted: result.exhausted,
      sampleJobKeys: result.sampleJobKeys
    });
  }

  return result.enqueued;
}

export async function runNextPersonaAgentJob(options?: {
  ignoreMode?: boolean;
  workerId?: string | null;
}) {
  if (!options?.ignoreMode && !isPersonaAgentEmbeddedMode()) {
    return null;
  }

  await reclaimStalePersonaAgentJobs();

  const workerId = options?.workerId?.trim() || getPersonaAgentWorkerId(options?.ignoreMode ? "lafz-standalone-persona-worker" : "lafz-persona-worker");
  const globals = getPersonaAgentGlobals();
  const summary = await processClaimedPersonaAgentJob(workerId);

  if (summary) {
    globals.__lafzPersonaAgentLastActivityAt = new Date().toISOString();
    globals.__lafzPersonaAgentLastSummary = summary;
  }

  return summary;
}

export async function runPersonaAgentUntilIdle(options?: {
  ignoreMode?: boolean;
  workerId?: string | null;
  reason?: string;
  maxJobs?: number | null;
}) {
  const globals = getPersonaAgentGlobals();
  const reason = options?.reason ?? "manual";
  globals.__lafzPersonaAgentLastKickReason = reason;

  const processed: PersonaAgentRunSummary[] = [];

  while (true) {
    if (options?.maxJobs && processed.length >= options.maxJobs) {
      break;
    }

    const summary = await runNextPersonaAgentJob(options);

    if (!summary) {
      const refilled = await refillPersonaBacklogIfIdle();

      if (refilled > 0) {
        continue;
      }

      break;
    }

    processed.push(summary);

    console.log("[lafz-brain] persona agent processed job.", {
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

export function kickPersonaAgentWorker(reason = "manual") {
  if (!isPersonaAgentEmbeddedMode()) {
    return;
  }

  const globals = getPersonaAgentGlobals();

  if (globals.__lafzPersonaAgentInFlight) {
    return;
  }

  globals.__lafzPersonaAgentInFlight = (async () => {
    try {
      await runPersonaAgentUntilIdle({ reason });
    } finally {
      globals.__lafzPersonaAgentInFlight = null;

      void hasActivePersonaAgentJobs()
        .then((hasActiveJobs) => {
          if (!hasActiveJobs) {
            return;
          }

          setTimeout(() => {
            kickPersonaAgentWorker("drain-pending");
          }, 0);
        })
        .catch((error) => {
          console.error("[lafz-brain] persona agent could not check for pending jobs after a run.", error);
        });
    }
  })();
}

export function ensurePersonaAgentWorkerStarted() {
  if (!isPersonaAgentEmbeddedMode()) {
    return;
  }

  const globals = getPersonaAgentGlobals();

  if (!globals.__lafzPersonaAgentStartedAt) {
    globals.__lafzPersonaAgentStartedAt = new Date().toISOString();
  }

  if (!globals.__lafzPersonaAgentInterval) {
    globals.__lafzPersonaAgentInterval = setInterval(() => {
      kickPersonaAgentWorker("interval");
    }, getPersonaAgentPollMs());
  }

  kickPersonaAgentWorker("startup");
}

export function getPersonaAgentProcessStatus() {
  const globals = getPersonaAgentGlobals();

  return {
    runtimeMode: getPersonaAgentRuntimeMode(),
    workerId: getPersonaAgentWorkerId(),
    pollMs: getPersonaAgentPollMs(),
    autoBacklogEnabled: isPersonaBacklogAutoRefillEnabled(),
    staleJobTimeoutMs: getPersonaAgentStaleJobTimeoutMs(),
    startedAt: globals.__lafzPersonaAgentStartedAt ?? null,
    lastKickReason: globals.__lafzPersonaAgentLastKickReason ?? null,
    lastActivityAt: globals.__lafzPersonaAgentLastActivityAt ?? null,
    lastBacklogRefillAt: globals.__lafzPersonaAgentLastBacklogRefillAt ?? null,
    lastBacklogRefillResult: globals.__lafzPersonaAgentLastBacklogRefillResult ?? null,
    inFlight: Boolean(globals.__lafzPersonaAgentInFlight),
    intervalActive: Boolean(globals.__lafzPersonaAgentInterval),
    lastSummary: globals.__lafzPersonaAgentLastSummary ?? null
  };
}
