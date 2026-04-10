import type { AiTranslationDraftFile } from "@/features/ai/types";
import type { PlaybackApiResponse } from "@/features/spotify/types";

export function serializeAiDraftForPlayback(
  aiDraft: AiTranslationDraftFile
): NonNullable<PlaybackApiResponse["aiDraft"]> {
  return {
    spotifyTrackId: aiDraft.spotifyTrackId,
    exists: true,
    lineCount: aiDraft.lines.length,
    mode: aiDraft.mode,
    model: aiDraft.generator.model,
    sourceLanguage: aiDraft.sourceLanguage,
    targetLanguage: aiDraft.targetLanguage,
    lines: aiDraft.lines.map((line) => ({
      order: line.order,
      original: line.original,
      translated: line.chosen,
      transliteration: line.transliteration,
      note: line.note
    }))
  };
}
