import { randomUUID } from "node:crypto";

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

declare global {
  var __lafzAiGenerationJobs: Map<string, AiGenerationJobInternal> | undefined;
}

function getJobStore() {
  if (!globalThis.__lafzAiGenerationJobs) {
    globalThis.__lafzAiGenerationJobs = new Map<string, AiGenerationJobInternal>();
  }

  return globalThis.__lafzAiGenerationJobs;
}

function updateJob(id: string, updater: (job: AiGenerationJobInternal) => AiGenerationJobInternal) {
  const jobStore = getJobStore();
  const current = jobStore.get(id);

  if (!current) {
    return null;
  }

  const next = updater(current);
  jobStore.set(id, next);
  return next;
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

export function startAiGenerationJob(options: GenerateAiTranslationOptions) {
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

  getJobStore().set(id, initialJob);

  void generateAiTranslationDraft(options)
    .then((result) => {
      updateJob(id, (job) => ({
        ...job,
        status: "succeeded",
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        resultStatus: result.status,
        message: formatStatusMessage(result.status),
        detail: null,
        costSummary: "costSummary" in result ? (result.costSummary ?? null) : null
      }));
    })
    .catch((error) => {
      updateJob(id, (job) => ({
        ...job,
        status: "failed",
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        resultStatus: "error",
        message: "Lafz could not generate the AI draft right now.",
        detail: error instanceof Error ? error.message : "Unknown AI error."
      }));
    });

  return initialJob;
}

export function getAiGenerationJob(id: string) {
  return getJobStore().get(id) ?? null;
}
