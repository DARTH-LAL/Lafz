import type { AiArtistMemory, AiTranslationDraftFile } from "@/features/ai/types";
import { getAiArtistMemory } from "@/features/ai/artist-memory";
import { getAiTranslationDraftByTrackId } from "@/features/ai/repository";
import { enqueueMotifAgentJob } from "@/features/brain/agent-jobs";
import { recordEntityClaimsIntoLafzBrain } from "@/features/brain/claims";
import {
  enqueueEntityBacklogBatch,
  getEntityBacklogRefillCooldownMs,
  hasActiveEntityAgentJobs,
  isEntityBacklogAutoRefillEnabled
} from "@/features/brain/entity-backlog";
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

const DEFAULT_ENTITY_AGENT_POLL_MS = 15_000;
const DEFAULT_ENTITY_AGENT_MAX_ATTEMPTS = 3;
const DEFAULT_ENTITY_AGENT_RETRY_BASE_MS = 30_000;
const DEFAULT_ENTITY_AGENT_RETRY_MAX_MS = 10 * 60_000;
const DEFAULT_ENTITY_AGENT_STALE_JOB_TIMEOUT_MS = 15 * 60_000;

export type EntityAgentRuntimeMode = "disabled" | "embedded" | "standalone";

type EntityArtistContext = {
  artistKey: string;
  displayName: string;
  memory: AiArtistMemory | null;
};

type EntityAgentRunSummary = {
  jobId: string;
  jobKey: string;
  spotifyTrackId: string;
  claimsUpserted: number;
  evidencesInserted: number;
  promotionsRecorded: number;
  artistsProcessed: number;
};

type EntityAgentGlobals = typeof globalThis & {
  __lafzEntityAgentInterval?: NodeJS.Timeout;
  __lafzEntityAgentInFlight?: Promise<void> | null;
  __lafzEntityAgentStartedAt?: string;
  __lafzEntityAgentLastKickReason?: string | null;
  __lafzEntityAgentLastActivityAt?: string | null;
  __lafzEntityAgentLastSummary?: EntityAgentRunSummary | null;
  __lafzEntityAgentLastBacklogRefillAt?: string | null;
  __lafzEntityAgentLastBacklogRefillResult?: {
    enqueued: number;
    candidatesFound: number;
    exhausted: boolean;
    sampleJobKeys: string[];
  } | null;
};

type StaleEntityAgentJobRow = {
  id: string;
  job_key: string;
  attempt_count: number;
  claimed_by: string | null;
  claimed_at: string | null;
  last_heartbeat_at: string | null;
};

function getEntityAgentGlobals() {
  return globalThis as EntityAgentGlobals;
}

export function getEntityAgentRuntimeMode(): EntityAgentRuntimeMode {
  const explicitMode = process.env.LAFZ_AGENT_RUNTIME_MODE?.trim().toLowerCase();

  if (explicitMode === "embedded" || explicitMode === "standalone" || explicitMode === "disabled") {
    return explicitMode;
  }

  if (process.env.LAFZ_AGENT_WORKER_ENABLED?.trim().toLowerCase() === "true") {
    return "embedded";
  }

  return "disabled";
}

function isEntityAgentEmbeddedMode() {
  return getEntityAgentRuntimeMode() === "embedded";
}

function getEntityAgentWorkerId(fallbackPrefix = "lafz-entity-worker") {
  return process.env.LAFZ_ENTITY_AGENT_WORKER_ID?.trim() || `${fallbackPrefix}-${process.pid}`;
}

function getEntityAgentPollMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_WORKER_POLL_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ENTITY_AGENT_POLL_MS;
}

function getEntityAgentMaxAttempts() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_MAX_ATTEMPTS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ENTITY_AGENT_MAX_ATTEMPTS;
}

function getEntityAgentRetryBaseMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_RETRY_BASE_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ENTITY_AGENT_RETRY_BASE_MS;
}

function getEntityAgentRetryMaxMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_RETRY_MAX_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ENTITY_AGENT_RETRY_MAX_MS;
}

function getEntityAgentStaleJobTimeoutMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_STALE_JOB_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_ENTITY_AGENT_STALE_JOB_TIMEOUT_MS;
}

function computeEntityAgentRetryDelayMs(attemptCount: number) {
  const retryIndex = Math.max(0, attemptCount - 1);
  const delay = getEntityAgentRetryBaseMs() * 2 ** retryIndex;
  return Math.min(delay, getEntityAgentRetryMaxMs());
}

async function loadEntityArtistContexts(draftFile: AiTranslationDraftFile) {
  const credits = splitArtistCredits(draftFile.artist);
  const contexts: EntityArtistContext[] = [];

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

function isStaleEntityAgentJob(row: StaleEntityAgentJobRow, timeoutMs: number) {
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

async function reclaimStaleEntityAgentJobs() {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return {
      reclaimed: 0,
      deadLettered: 0,
      sampleJobKeys: [] as string[]
    };
  }

  const timeoutMs = getEntityAgentStaleJobTimeoutMs();
  const maxAttempts = getEntityAgentMaxAttempts();
  const { data, error } = await supabase
    .from("agent_jobs")
    .select("id, job_key, attempt_count, claimed_by, claimed_at, last_heartbeat_at")
    .eq("job_type", "entity_agent")
    .in("status", ["claimed", "running"])
    .order("updated_at", { ascending: true })
    .limit(100);

  if (error) {
    console.error("[lafz-brain] could not scan stale entity jobs.", error);
    return {
      reclaimed: 0,
      deadLettered: 0,
      sampleJobKeys: [] as string[]
    };
  }

  const staleJobs = (data ?? [])
    .filter((row): row is StaleEntityAgentJobRow => Boolean(row && typeof row.id === "string" && typeof row.job_key === "string"))
    .filter((row) => isStaleEntityAgentJob(row, timeoutMs));

  if (staleJobs.length === 0) {
    return {
      reclaimed: 0,
      deadLettered: 0,
      sampleJobKeys: [] as string[]
    };
  }

  const now = new Date().toISOString();
  const staleMessage = `Recovered stale entity job after ${timeoutMs}ms without heartbeat.`;
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
      console.error("[lafz-brain] could not reclaim stale entity job.", {
        jobKey: job.job_key,
        error: jobError
      });
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
      .eq("agent_role", "entity_agent")
      .eq("status", "running");

    if (runError) {
      console.error("[lafz-brain] could not mark stale entity run as cancelled.", {
        jobKey: job.job_key,
        error: runError
      });
    }

    if (shouldDeadLetter) {
      deadLettered += 1;
    } else {
      reclaimed += 1;
    }
  }

  return {
    reclaimed,
    deadLettered,
    sampleJobKeys
  };
}

async function finalizeEntityAgentFailureJob(options: {
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

async function processClaimedEntityAgentJob(workerId: string): Promise<EntityAgentRunSummary | null> {
  const job = await claimNextAgentJob(workerId, "entity_agent");

  if (!job) {
    return null;
  }

  const run = await insertAgentRun({
    jobId: job.id,
    agentRole: "entity_agent",
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
      throw new Error("Entity agent job is missing spotifyTrackId.");
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
      throw new Error(`Entity agent job ${job.jobKey} is missing songNodeId.`);
    }

    const artists = await loadEntityArtistContexts(draftFile);

    await heartbeatAgentJob(job.id, workerId);

    const summary = await recordEntityClaimsIntoLafzBrain({
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

    void enqueueMotifAgentJob({
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
    const message = error instanceof Error ? error.message : "Unknown entity-agent error.";
    const maxAttempts = getEntityAgentMaxAttempts();
    const shouldRetry = job.attemptCount < maxAttempts;
    const retryDelayMs = shouldRetry ? computeEntityAgentRetryDelayMs(job.attemptCount) : 0;
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

    await finalizeEntityAgentFailureJob({
      jobId: job.id,
      jobKey: job.jobKey,
      workerId,
      shouldRetry,
      nextJobStatus,
      nextAvailableAt,
      message
    });

    console.error("[lafz-brain] entity agent job failed.", {
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

async function refillEntityBacklogIfIdle() {
  if (!isEntityBacklogAutoRefillEnabled()) {
    return 0;
  }

  const globals = getEntityAgentGlobals();
  const cooldownMs = getEntityBacklogRefillCooldownMs();
  const lastRefillAt = globals.__lafzEntityAgentLastBacklogRefillAt
    ? new Date(globals.__lafzEntityAgentLastBacklogRefillAt).getTime()
    : 0;

  if (Date.now() - lastRefillAt < cooldownMs) {
    return 0;
  }

  const hasActiveJobs = await hasActiveEntityAgentJobs();

  if (hasActiveJobs) {
    return 0;
  }

  const result = await enqueueEntityBacklogBatch();
  globals.__lafzEntityAgentLastBacklogRefillAt = new Date().toISOString();
  globals.__lafzEntityAgentLastBacklogRefillResult = result;

  if (result.enqueued > 0) {
    console.log("[lafz-brain] entity backlog refill queued jobs.", {
      enqueued: result.enqueued,
      candidatesFound: result.candidatesFound,
      exhausted: result.exhausted,
      sampleJobKeys: result.sampleJobKeys
    });
  }

  return result.enqueued;
}

export async function runNextEntityAgentJob(options?: {
  ignoreMode?: boolean;
  workerId?: string | null;
}) {
  if (!options?.ignoreMode && !isEntityAgentEmbeddedMode()) {
    return null;
  }

  await reclaimStaleEntityAgentJobs();

  const workerId = options?.workerId?.trim() || getEntityAgentWorkerId(options?.ignoreMode ? "lafz-standalone-entity-worker" : "lafz-entity-worker");
  const globals = getEntityAgentGlobals();
  const summary = await processClaimedEntityAgentJob(workerId);

  if (summary) {
    globals.__lafzEntityAgentLastActivityAt = new Date().toISOString();
    globals.__lafzEntityAgentLastSummary = summary;
  }

  return summary;
}

export async function runEntityAgentUntilIdle(options?: {
  ignoreMode?: boolean;
  workerId?: string | null;
  reason?: string;
  maxJobs?: number | null;
}) {
  const globals = getEntityAgentGlobals();
  const reason = options?.reason ?? "manual";
  globals.__lafzEntityAgentLastKickReason = reason;

  const processed: EntityAgentRunSummary[] = [];

  while (true) {
    if (options?.maxJobs && processed.length >= options.maxJobs) {
      break;
    }

    const summary = await runNextEntityAgentJob(options);

    if (!summary) {
      const refilled = await refillEntityBacklogIfIdle();

      if (refilled > 0) {
        continue;
      }

      break;
    }

    processed.push(summary);

    console.log("[lafz-brain] entity agent processed job.", {
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

export function kickEntityAgentWorker(reason = "manual") {
  if (!isEntityAgentEmbeddedMode()) {
    return;
  }

  const globals = getEntityAgentGlobals();

  if (globals.__lafzEntityAgentInFlight) {
    return;
  }

  globals.__lafzEntityAgentInFlight = (async () => {
    try {
      await runEntityAgentUntilIdle({ reason });
    } finally {
      globals.__lafzEntityAgentInFlight = null;

      void hasActiveEntityAgentJobs()
        .then((hasActiveJobs) => {
          if (!hasActiveJobs) {
            return;
          }

          setTimeout(() => {
            kickEntityAgentWorker("drain-pending");
          }, 0);
        })
        .catch((error) => {
          console.error("[lafz-brain] entity agent could not check for pending jobs after a run.", error);
        });
    }
  })();
}

export function ensureEntityAgentWorkerStarted() {
  if (!isEntityAgentEmbeddedMode()) {
    return;
  }

  const globals = getEntityAgentGlobals();

  if (!globals.__lafzEntityAgentStartedAt) {
    globals.__lafzEntityAgentStartedAt = new Date().toISOString();
  }

  if (!globals.__lafzEntityAgentInterval) {
    globals.__lafzEntityAgentInterval = setInterval(() => {
      kickEntityAgentWorker("interval");
    }, getEntityAgentPollMs());
  }

  kickEntityAgentWorker("startup");
}

export function getEntityAgentProcessStatus() {
  const globals = getEntityAgentGlobals();

  return {
    runtimeMode: getEntityAgentRuntimeMode(),
    workerId: getEntityAgentWorkerId(),
    pollMs: getEntityAgentPollMs(),
    autoBacklogEnabled: isEntityBacklogAutoRefillEnabled(),
    staleJobTimeoutMs: getEntityAgentStaleJobTimeoutMs(),
    startedAt: globals.__lafzEntityAgentStartedAt ?? null,
    lastKickReason: globals.__lafzEntityAgentLastKickReason ?? null,
    lastActivityAt: globals.__lafzEntityAgentLastActivityAt ?? null,
    lastBacklogRefillAt: globals.__lafzEntityAgentLastBacklogRefillAt ?? null,
    lastBacklogRefillResult: globals.__lafzEntityAgentLastBacklogRefillResult ?? null,
    inFlight: Boolean(globals.__lafzEntityAgentInFlight),
    intervalActive: Boolean(globals.__lafzEntityAgentInterval),
    lastSummary: globals.__lafzEntityAgentLastSummary ?? null
  };
}
