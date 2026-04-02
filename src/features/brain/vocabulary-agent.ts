import type { AiArtistMemory, AiTranslationDraftFile } from "@/features/ai/types";
import { getAiArtistMemory } from "@/features/ai/artist-memory";
import { getAiTranslationDraftByTrackId } from "@/features/ai/repository";
import { enqueueEntityAgentJob } from "@/features/brain/agent-jobs";
import { recordVocabularyClaimsIntoLafzBrain } from "@/features/brain/claims";
import {
  enqueueVocabularyBacklogBatch,
  getVocabularyBacklogRefillCooldownMs,
  hasActiveVocabularyAgentJobs,
  isVocabularyBacklogAutoRefillEnabled
} from "@/features/brain/vocabulary-backlog";
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

const DEFAULT_VOCABULARY_AGENT_POLL_MS = 15_000;
const DEFAULT_VOCABULARY_AGENT_MAX_ATTEMPTS = 3;
const DEFAULT_VOCABULARY_AGENT_RETRY_BASE_MS = 30_000;
const DEFAULT_VOCABULARY_AGENT_RETRY_MAX_MS = 10 * 60_000;
const DEFAULT_VOCABULARY_AGENT_STALE_JOB_TIMEOUT_MS = 15 * 60_000;

export type VocabularyAgentRuntimeMode = "disabled" | "embedded" | "standalone";

type VocabularyArtistContext = {
  artistKey: string;
  displayName: string;
  memory: AiArtistMemory | null;
};

type VocabularyAgentRunSummary = {
  jobId: string;
  jobKey: string;
  spotifyTrackId: string;
  claimsUpserted: number;
  evidencesInserted: number;
  promotionsRecorded: number;
  artistsProcessed: number;
};

type VocabularyAgentGlobals = typeof globalThis & {
  __lafzVocabularyAgentInterval?: NodeJS.Timeout;
  __lafzVocabularyAgentInFlight?: Promise<void> | null;
  __lafzVocabularyAgentStartedAt?: string;
  __lafzVocabularyAgentLastKickReason?: string | null;
  __lafzVocabularyAgentLastActivityAt?: string | null;
  __lafzVocabularyAgentLastSummary?: VocabularyAgentRunSummary | null;
  __lafzVocabularyAgentLastBacklogRefillAt?: string | null;
  __lafzVocabularyAgentLastBacklogRefillResult?: {
    enqueued: number;
    candidatesFound: number;
    exhausted: boolean;
    sampleJobKeys: string[];
  } | null;
};

function getVocabularyAgentGlobals() {
  return globalThis as VocabularyAgentGlobals;
}

export function getVocabularyAgentRuntimeMode(): VocabularyAgentRuntimeMode {
  const explicitMode = process.env.LAFZ_AGENT_RUNTIME_MODE?.trim().toLowerCase();

  if (explicitMode === "embedded" || explicitMode === "standalone" || explicitMode === "disabled") {
    return explicitMode;
  }

  if (process.env.LAFZ_AGENT_WORKER_ENABLED?.trim().toLowerCase() === "true") {
    return "embedded";
  }

  return "disabled";
}

function isVocabularyAgentEmbeddedMode() {
  return getVocabularyAgentRuntimeMode() === "embedded";
}

function getVocabularyAgentWorkerId(fallbackPrefix = "lafz-app-worker") {
  return process.env.LAFZ_AGENT_WORKER_ID?.trim() || `${fallbackPrefix}-${process.pid}`;
}

function getVocabularyAgentPollMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_WORKER_POLL_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VOCABULARY_AGENT_POLL_MS;
}

function getVocabularyAgentMaxAttempts() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_MAX_ATTEMPTS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VOCABULARY_AGENT_MAX_ATTEMPTS;
}

function getVocabularyAgentRetryBaseMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_RETRY_BASE_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VOCABULARY_AGENT_RETRY_BASE_MS;
}

function getVocabularyAgentRetryMaxMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_RETRY_MAX_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VOCABULARY_AGENT_RETRY_MAX_MS;
}

function getVocabularyAgentStaleJobTimeoutMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_STALE_JOB_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VOCABULARY_AGENT_STALE_JOB_TIMEOUT_MS;
}

function computeVocabularyAgentRetryDelayMs(attemptCount: number) {
  const retryIndex = Math.max(0, attemptCount - 1);
  const delay = getVocabularyAgentRetryBaseMs() * 2 ** retryIndex;
  return Math.min(delay, getVocabularyAgentRetryMaxMs());
}

function getMemorySignalScore(memory: AiArtistMemory | null) {
  if (!memory) {
    return 0;
  }

  return (
    (memory.glossaryEntries?.length ?? 0) * 5 +
    (memory.canonicalRenderings?.length ?? 0) * 6 +
    (memory.recurringMotifs?.length ?? 0)
  );
}

function chooseBestArtistMemory(artistKey: string, loadedMemory: AiArtistMemory | null, draftMemory: AiArtistMemory | null) {
  if (!draftMemory || draftMemory.artistKey !== artistKey) {
    return loadedMemory;
  }

  return getMemorySignalScore(draftMemory) > getMemorySignalScore(loadedMemory) ? draftMemory : loadedMemory ?? draftMemory;
}

async function loadVocabularyArtistContexts(draftFile: AiTranslationDraftFile) {
  const credits = splitArtistCredits(draftFile.artist);
  const contexts: VocabularyArtistContext[] = [];

  for (const credit of credits) {
    const { memory } = await getAiArtistMemory(credit.name).catch(() => ({ memory: null }));
    const bestMemory = chooseBestArtistMemory(credit.key, memory, draftFile.artistMemory);

    contexts.push({
      artistKey: credit.key,
      displayName: bestMemory?.displayName ?? credit.name,
      memory: bestMemory
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

type StaleVocabularyAgentJobRow = {
  id: string;
  job_key: string;
  attempt_count: number;
  claimed_by: string | null;
  claimed_at: string | null;
  last_heartbeat_at: string | null;
};

function isStaleVocabularyAgentJob(row: StaleVocabularyAgentJobRow, timeoutMs: number) {
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

async function reclaimStaleVocabularyAgentJobs() {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return {
      reclaimed: 0,
      deadLettered: 0,
      sampleJobKeys: [] as string[]
    };
  }

  const timeoutMs = getVocabularyAgentStaleJobTimeoutMs();
  const maxAttempts = getVocabularyAgentMaxAttempts();
  const { data, error } = await supabase
    .from("agent_jobs")
    .select("id, job_key, attempt_count, claimed_by, claimed_at, last_heartbeat_at")
    .eq("job_type", "vocabulary_agent")
    .in("status", ["claimed", "running"])
    .order("updated_at", { ascending: true })
    .limit(100);

  if (error) {
    console.error("[lafz-brain] could not scan stale vocabulary jobs.", error);
    return {
      reclaimed: 0,
      deadLettered: 0,
      sampleJobKeys: [] as string[]
    };
  }

  const staleJobs = (data ?? []).filter((row): row is StaleVocabularyAgentJobRow => Boolean(row && typeof row.id === "string" && typeof row.job_key === "string"))
    .filter((row) => isStaleVocabularyAgentJob(row, timeoutMs));

  if (staleJobs.length === 0) {
    return {
      reclaimed: 0,
      deadLettered: 0,
      sampleJobKeys: [] as string[]
    };
  }

  const now = new Date().toISOString();
  const staleMessage = `Recovered stale vocabulary job after ${timeoutMs}ms without heartbeat.`;
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
      console.error("[lafz-brain] could not reclaim stale vocabulary job.", {
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
      .eq("agent_role", "vocabulary_agent")
      .eq("status", "running");

    if (runError) {
      console.error("[lafz-brain] could not mark stale vocabulary run as cancelled.", {
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

  if (reclaimed > 0 || deadLettered > 0) {
    console.log("[lafz-brain] recovered stale vocabulary jobs.", {
      timeoutMs,
      reclaimed,
      deadLettered,
      sampleJobKeys
    });
  }

  return {
    reclaimed,
    deadLettered,
    sampleJobKeys
  };
}

async function finalizeVocabularyAgentFailureJob(options: {
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

  if (observed?.status === options.nextJobStatus) {
    return observed;
  }

  console.warn("[lafz-brain] vocabulary agent failure transition did not stick cleanly.", {
    jobKey: options.jobKey,
    expectedStatus: options.nextJobStatus,
    observedStatus: observed?.status ?? null
  });

  return observed;
}

async function processClaimedVocabularyAgentJob(workerId: string): Promise<VocabularyAgentRunSummary | null> {
  const job = await claimNextAgentJob(workerId, "vocabulary_agent");

  if (!job) {
    return null;
  }

  const run = await insertAgentRun({
    jobId: job.id,
    agentRole: "vocabulary_agent",
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
      throw new Error("Vocabulary agent job is missing spotifyTrackId.");
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
      throw new Error(`Vocabulary agent job ${job.jobKey} is missing songNodeId.`);
    }

    const artists = await loadVocabularyArtistContexts(draftFile);

    await heartbeatAgentJob(job.id, workerId);

    const summary = await recordVocabularyClaimsIntoLafzBrain({
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

    void enqueueEntityAgentJob({
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
    const message = error instanceof Error ? error.message : "Unknown vocabulary-agent error.";
    const maxAttempts = getVocabularyAgentMaxAttempts();
    const shouldRetry = job.attemptCount < maxAttempts;
    const retryDelayMs = shouldRetry ? computeVocabularyAgentRetryDelayMs(job.attemptCount) : 0;
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

    await finalizeVocabularyAgentFailureJob({
      jobId: job.id,
      jobKey: job.jobKey,
      workerId,
      shouldRetry,
      nextJobStatus,
      nextAvailableAt,
      message
    });

    console.error("[lafz-brain] vocabulary agent job failed.", {
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

async function refillVocabularyBacklogIfIdle() {
  if (!isVocabularyBacklogAutoRefillEnabled()) {
    return 0;
  }

  const globals = getVocabularyAgentGlobals();
  const cooldownMs = getVocabularyBacklogRefillCooldownMs();
  const lastRefillAt = globals.__lafzVocabularyAgentLastBacklogRefillAt
    ? new Date(globals.__lafzVocabularyAgentLastBacklogRefillAt).getTime()
    : 0;

  if (Date.now() - lastRefillAt < cooldownMs) {
    return 0;
  }

  const hasActiveJobs = await hasActiveVocabularyAgentJobs();

  if (hasActiveJobs) {
    return 0;
  }

  const result = await enqueueVocabularyBacklogBatch();
  globals.__lafzVocabularyAgentLastBacklogRefillAt = new Date().toISOString();
  globals.__lafzVocabularyAgentLastBacklogRefillResult = result;

  if (result.enqueued > 0) {
    console.log("[lafz-brain] vocabulary backlog refill queued jobs.", {
      enqueued: result.enqueued,
      candidatesFound: result.candidatesFound,
      exhausted: result.exhausted,
      sampleJobKeys: result.sampleJobKeys
    });
  }

  return result.enqueued;
}

export async function runNextVocabularyAgentJob(options?: {
  ignoreMode?: boolean;
  workerId?: string | null;
}) {
  if (!options?.ignoreMode && !isVocabularyAgentEmbeddedMode()) {
    return null;
  }

  await reclaimStaleVocabularyAgentJobs();

  const workerId = options?.workerId?.trim() || getVocabularyAgentWorkerId(options?.ignoreMode ? "lafz-standalone-worker" : "lafz-app-worker");
  const globals = getVocabularyAgentGlobals();
  const summary = await processClaimedVocabularyAgentJob(workerId);

  if (summary) {
    globals.__lafzVocabularyAgentLastActivityAt = new Date().toISOString();
    globals.__lafzVocabularyAgentLastSummary = summary;
  }

  return summary;
}

export async function runVocabularyAgentUntilIdle(options?: {
  ignoreMode?: boolean;
  workerId?: string | null;
  reason?: string;
  maxJobs?: number | null;
}) {
  const globals = getVocabularyAgentGlobals();
  const reason = options?.reason ?? "manual";
  globals.__lafzVocabularyAgentLastKickReason = reason;

  const processed: VocabularyAgentRunSummary[] = [];

  while (true) {
    if (options?.maxJobs && processed.length >= options.maxJobs) {
      break;
    }

    const summary = await runNextVocabularyAgentJob(options);

    if (!summary) {
      const refilled = await refillVocabularyBacklogIfIdle();

      if (refilled > 0) {
        continue;
      }

      break;
    }

    processed.push(summary);

    console.log("[lafz-brain] vocabulary agent processed job.", {
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

export function kickVocabularyAgentWorker(reason = "manual") {
  if (!isVocabularyAgentEmbeddedMode()) {
    return;
  }

  const globals = getVocabularyAgentGlobals();

  if (globals.__lafzVocabularyAgentInFlight) {
    return;
  }

  globals.__lafzVocabularyAgentInFlight = (async () => {
    try {
      await runVocabularyAgentUntilIdle({ reason });
    } finally {
      globals.__lafzVocabularyAgentInFlight = null;

      void hasActiveVocabularyAgentJobs()
        .then((hasActiveJobs) => {
          if (!hasActiveJobs) {
            return;
          }

          setTimeout(() => {
            kickVocabularyAgentWorker("drain-pending");
          }, 0);
        })
        .catch((error) => {
          console.error("[lafz-brain] vocabulary agent could not check for pending jobs after a run.", error);
        });
    }
  })();
}

export function ensureVocabularyAgentWorkerStarted() {
  if (!isVocabularyAgentEmbeddedMode()) {
    return;
  }

  const globals = getVocabularyAgentGlobals();

  if (!globals.__lafzVocabularyAgentStartedAt) {
    globals.__lafzVocabularyAgentStartedAt = new Date().toISOString();
  }

  if (!globals.__lafzVocabularyAgentInterval) {
    globals.__lafzVocabularyAgentInterval = setInterval(() => {
      kickVocabularyAgentWorker("interval");
    }, getVocabularyAgentPollMs());
  }

  kickVocabularyAgentWorker("startup");
}

export function getVocabularyAgentProcessStatus() {
  const globals = getVocabularyAgentGlobals();

  return {
    runtimeMode: getVocabularyAgentRuntimeMode(),
    workerId: getVocabularyAgentWorkerId(),
    pollMs: getVocabularyAgentPollMs(),
    autoBacklogEnabled: isVocabularyBacklogAutoRefillEnabled(),
    staleJobTimeoutMs: getVocabularyAgentStaleJobTimeoutMs(),
    startedAt: globals.__lafzVocabularyAgentStartedAt ?? null,
    lastKickReason: globals.__lafzVocabularyAgentLastKickReason ?? null,
    lastActivityAt: globals.__lafzVocabularyAgentLastActivityAt ?? null,
    lastBacklogRefillAt: globals.__lafzVocabularyAgentLastBacklogRefillAt ?? null,
    lastBacklogRefillResult: globals.__lafzVocabularyAgentLastBacklogRefillResult ?? null,
    inFlight: Boolean(globals.__lafzVocabularyAgentInFlight),
    intervalActive: Boolean(globals.__lafzVocabularyAgentInterval),
    lastSummary: globals.__lafzVocabularyAgentLastSummary ?? null
  };
}
