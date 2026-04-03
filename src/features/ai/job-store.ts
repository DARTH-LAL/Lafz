import { randomUUID } from "node:crypto";

import { getSupabaseServerClient } from "@/features/cloud/supabase";
import { generateAiTranslationDraft } from "@/features/ai/translation-draft";
import type { AiCostSummary, GenerateAiTranslationOptions } from "@/features/ai/types";

type AiGenerationJobStatus = "running" | "succeeded" | "failed";

export type AiGenerationJob = {
  id: string;
  trackId: string;
  status: AiGenerationJobStatus;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  resultStatus: string | null;
  message: string | null;
  detail: string | null;
  costSummary: AiCostSummary | null;
};

type AiGenerationJobInternal = AiGenerationJob;

const AI_GENERATION_JOB_TYPE = "translation_generation";
const AI_GENERATION_SCOPE_TYPE = "song";

declare global {
  var __lafzAiGenerationJobs: Map<string, AiGenerationJobInternal> | undefined;
}

function getJobStore() {
  if (!globalThis.__lafzAiGenerationJobs) {
    globalThis.__lafzAiGenerationJobs = new Map<string, AiGenerationJobInternal>();
  }

  return globalThis.__lafzAiGenerationJobs;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAiCostBreakdown(value: unknown): value is { model: string; inputTokens: number; outputTokens: number; costUsd: number } {
  return (
    isRecord(value) &&
    typeof value.model === "string" &&
    typeof value.inputTokens === "number" &&
    typeof value.outputTokens === "number" &&
    typeof value.costUsd === "number"
  );
}

function asAiCostSummary(value: unknown): AiCostSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  if (!isAiCostBreakdown(value.generatorA) || !isAiCostBreakdown(value.generatorB) || !isAiCostBreakdown(value.judge)) {
    return null;
  }

  if (typeof value.totalCostUsd !== "number") {
    return null;
  }

  return {
    generatorA: value.generatorA,
    generatorB: value.generatorB,
    judge: value.judge,
    totalCostUsd: value.totalCostUsd
  };
}

function buildJobKey(id: string) {
  return `${AI_GENERATION_JOB_TYPE}::${id}`;
}

function readStoredJob(payload: unknown): AiGenerationJob | null {
  if (!isRecord(payload)) {
    return null;
  }

  const stored = isRecord(payload.aiGenerationJob) ? payload.aiGenerationJob : payload;
  const id = asString(stored.id);
  const trackId = asString(stored.trackId);
  const status = asString(stored.status) as AiGenerationJobStatus | null;
  const startedAt = asString(stored.startedAt);
  const updatedAt = asString(stored.updatedAt);

  if (!id || !trackId || !status || !startedAt || !updatedAt) {
    return null;
  }

  return {
    id,
    trackId,
    status,
    startedAt,
    updatedAt,
    completedAt: asString(stored.completedAt),
    resultStatus: asString(stored.resultStatus),
    message: asString(stored.message),
    detail: asString(stored.detail),
    costSummary: asAiCostSummary(stored.costSummary)
  };
}

function cacheJob(job: AiGenerationJobInternal) {
  getJobStore().set(job.id, job);
  return job;
}

function updateCachedJob(id: string, updater: (job: AiGenerationJobInternal) => AiGenerationJobInternal) {
  const current = getJobStore().get(id);

  if (!current) {
    return null;
  }

  return cacheJob(updater(current));
}

async function persistJob(job: AiGenerationJobInternal) {
  cacheJob(job);

  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return job;
  }

  const { error } = await supabase.from("agent_jobs").upsert(
    {
      job_key: buildJobKey(job.id),
      job_type: AI_GENERATION_JOB_TYPE,
      status: job.status === "running" ? "running" : job.status === "succeeded" ? "completed" : "failed",
      scope_type: AI_GENERATION_SCOPE_TYPE,
      scope_key: job.trackId,
      spotify_track_id: job.trackId,
      priority: 0,
      available_at: job.startedAt,
      claimed_at: job.startedAt,
      claimed_by: null,
      last_heartbeat_at: job.updatedAt,
      last_error: job.detail,
      payload_json: {
        aiGenerationJob: job
      },
      updated_at: job.updatedAt
    },
    { onConflict: "job_key" }
  );

  if (error) {
    throw new Error(`Could not persist AI generation job: ${error.message}`);
  }

  return job;
}

async function loadPersistedJob(id: string) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("agent_jobs")
    .select("payload_json")
    .eq("job_key", buildJobKey(id))
    .maybeSingle();

  if (error) {
    console.error("[ai-job-store] could not read persisted job", { id, error });
    return null;
  }

  const parsed = readStoredJob(data?.payload_json ?? null);

  if (parsed) {
    cacheJob(parsed);
  }

  return parsed;
}

function formatStatusMessage(status: string) {
  if (status === "saved_translation") {
    return "Lafz generated a reviewed AI draft and updated the synced translation file.";
  }

  if (status === "draft_only_plain") {
    return "Lafz generated a reviewed AI draft and kept it on this track page because the lyrics are still untimed.";
  }

  if (status === "draft_only_preserved") {
    return "Lafz generated a reviewed AI draft and preserved the existing translation file.";
  }

  if (status === "missing_lyrics") {
    return "Fetch or import original lyrics before generating a translation draft.";
  }

  return "Lafz finished the AI draft run.";
}

export async function startAiGenerationJob(options: GenerateAiTranslationOptions) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const initialJob: AiGenerationJobInternal = {
    id,
    trackId: options.spotifyTrackId,
    status: "running",
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    resultStatus: null,
    message: "Lafz started generating the AI draft.",
    detail: null,
    costSummary: null
  };

  await persistJob(initialJob);

  void generateAiTranslationDraft(options)
    .then(async (result) => {
      const nextJob =
        updateCachedJob(id, (job) => ({
          ...job,
          status: "succeeded",
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          resultStatus: result.status,
          message: formatStatusMessage(result.status),
          detail: null,
          costSummary: "costSummary" in result ? (result.costSummary ?? null) : null
        })) ??
        ({
          ...initialJob,
          status: "succeeded",
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          resultStatus: result.status,
          message: formatStatusMessage(result.status),
          detail: null,
          costSummary: "costSummary" in result ? (result.costSummary ?? null) : null
        } satisfies AiGenerationJobInternal);

      try {
        await persistJob(nextJob);
      } catch (error) {
        console.error("[ai-job-store] could not persist successful job result", {
          id,
          error
        });
      }
    })
    .catch(async (error) => {
      const nextJob =
        updateCachedJob(id, (job) => ({
          ...job,
          status: "failed",
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          resultStatus: "error",
          message: "Lafz could not generate the AI draft right now.",
          detail: error instanceof Error ? error.message : "Unknown AI error."
        })) ??
        ({
          ...initialJob,
          status: "failed",
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          resultStatus: "error",
          message: "Lafz could not generate the AI draft right now.",
          detail: error instanceof Error ? error.message : "Unknown AI error."
        } satisfies AiGenerationJobInternal);

      try {
        await persistJob(nextJob);
      } catch (persistError) {
        console.error("[ai-job-store] could not persist failed job result", {
          id,
          error: persistError
        });
      }
    });

  return initialJob;
}

export async function getAiGenerationJob(id: string) {
  const supabase = getSupabaseServerClient();

  if (supabase) {
    return loadPersistedJob(id);
  }

  return getJobStore().get(id) ?? null;
}
