import type { AiTranslationDraftInspection } from "@/features/ai/types";
import type { LyricsCacheInspection } from "@/features/lyrics/types";
import type { StudioQueueStatus } from "@/features/library/types";
import type { TranslationFileInspection } from "@/features/translations/types";

export type DerivedStudioStatus = {
  status: StudioQueueStatus;
  reason: string;
  readyToPublish: boolean;
  published: boolean;
  needsReviewCount: number;
  reviewCompletionRatio: number;
};

function isLyricsReady(kind: LyricsCacheInspection["kind"]) {
  return kind === "synced" || kind === "plain";
}

function isSyncedOutputAvailable(translationInspection: TranslationFileInspection, aiDraftInspection: AiTranslationDraftInspection) {
  if (translationInspection.kind === "translated") {
    return true;
  }

  return aiDraftInspection.mode === "synced" && aiDraftInspection.lineCount > 0;
}

function clampRatio(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 1) {
    return 1;
  }

  return value;
}

export function deriveStudioStatus(input: {
  lyricsInspection: LyricsCacheInspection;
  translationInspection: TranslationFileInspection;
  aiDraftInspection: AiTranslationDraftInspection;
}) {
  const { lyricsInspection, translationInspection, aiDraftInspection } = input;
  const needsReviewCount = aiDraftInspection.lowConfidenceCount + aiDraftInspection.mediumConfidenceCount;
  const reviewCompletionRatio =
    aiDraftInspection.lineCount > 0 ? clampRatio((aiDraftInspection.highConfidenceCount + aiDraftInspection.manualReviewCount) / aiDraftInspection.lineCount) : 0;
  const published = translationInspection.published;
  const lyricsReady = isLyricsReady(lyricsInspection.kind);
  const syncedOutputAvailable = isSyncedOutputAvailable(translationInspection, aiDraftInspection);

  if (published) {
    return {
      status: "published",
      reason: "This song has been marked ready for the consumer app.",
      readyToPublish: false,
      published,
      needsReviewCount,
      reviewCompletionRatio
    } satisfies DerivedStudioStatus;
  }

  if (!lyricsReady) {
    return {
      status: "needs_lyrics",
      reason: "Import synced or plain original lyrics before Lafz can draft a translation.",
      readyToPublish: false,
      published,
      needsReviewCount,
      reviewCompletionRatio
    } satisfies DerivedStudioStatus;
  }

  if (!aiDraftInspection.exists || aiDraftInspection.mode === "missing") {
    return {
      status: "lyrics_ready",
      reason: "Original lyrics are ready, but the AI draft has not been generated yet.",
      readyToPublish: false,
      published,
      needsReviewCount,
      reviewCompletionRatio
    } satisfies DerivedStudioStatus;
  }

  if (aiDraftInspection.mode === "malformed") {
    return {
      status: "needs_review",
      reason: "The current AI draft file could not be parsed cleanly and needs attention.",
      readyToPublish: false,
      published,
      needsReviewCount: Math.max(needsReviewCount, 1),
      reviewCompletionRatio
    } satisfies DerivedStudioStatus;
  }

  if (needsReviewCount > 0) {
    return {
      status: "needs_review",
      reason: `${needsReviewCount} draft line${needsReviewCount === 1 ? "" : "s"} still need review.`,
      readyToPublish: false,
      published,
      needsReviewCount,
      reviewCompletionRatio
    } satisfies DerivedStudioStatus;
  }

  if (syncedOutputAvailable) {
    return {
      status: "synced",
      reason: "A synced translation is ready for playback and can be published when you are happy with it.",
      readyToPublish: true,
      published,
      needsReviewCount,
      reviewCompletionRatio
    } satisfies DerivedStudioStatus;
  }

  return {
    status: "reviewed",
    reason: "The draft is reviewed, but it still needs synced lyrics before playback can follow it line by line.",
    readyToPublish: false,
    published,
    needsReviewCount,
    reviewCompletionRatio
  } satisfies DerivedStudioStatus;
}
