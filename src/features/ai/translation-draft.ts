import { getAiGlossaryEntries } from "@/features/ai/glossary";
import { getActiveAiProvider, requestProviderTranslationDraft } from "@/features/ai/provider";
import { writeAiTranslationDraftFile } from "@/features/ai/repository";
import type { GenerateAiTranslationOptions, GenerateAiTranslationResult } from "@/features/ai/types";
import { getLyricsCacheByTrackId } from "@/features/lyrics/repository";
import type { LyricsCacheFile } from "@/features/lyrics/types";
import { inspectTranslationFile } from "@/features/translations/inspection";
import { writeTrackTranslationFile } from "@/features/translations/repository";
import type { TrackTranslation } from "@/features/translations/types";

const MAX_LINES_PER_BATCH_SYNCED = 8;
const MAX_LINES_PER_BATCH_PLAIN = 1;
const CONTEXT_WINDOW_LINES = 1;

type SourceDraftLine = {
  order: number;
  original: string;
  startMs: number | null;
  endMs: number | null;
};

function normalizeLanguage(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Unknown";
}

function buildSyncedSourceLines(cacheFile: LyricsCacheFile): SourceDraftLine[] {
  return cacheFile.lines.map((line, index) => {
    const nextStartMs = cacheFile.lines[index + 1]?.startMs ?? cacheFile.durationMs;
    const clampedEndMs =
      nextStartMs > line.startMs ? nextStartMs - 1 : Math.max(line.startMs, Math.min(cacheFile.durationMs, line.startMs + 4_000));

    return {
      order: index,
      original: line.text,
      startMs: line.startMs,
      endMs: clampedEndMs
    };
  });
}

function buildPlainSourceLines(cacheFile: LyricsCacheFile): SourceDraftLine[] {
  return (cacheFile.plainLyrics ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      order: index,
      original: line,
      startMs: null,
      endMs: null
    }));
}

function buildSourceLines(cacheFile: LyricsCacheFile) {
  return cacheFile.kind === "synced" ? buildSyncedSourceLines(cacheFile) : buildPlainSourceLines(cacheFile);
}

function chunkSourceLines(lines: SourceDraftLine[], chunkSize: number) {
  const chunks: SourceDraftLine[][] = [];

  for (let index = 0; index < lines.length; index += chunkSize) {
    chunks.push(lines.slice(index, index + chunkSize));
  }

  return chunks;
}

function buildContextLines(lines: SourceDraftLine[], centerIndex: number, startOffset: number, endOffset: number) {
  const context: string[] = [];

  for (let offset = startOffset; offset <= endOffset; offset += 1) {
    if (offset === 0) {
      continue;
    }

    const candidate = lines[centerIndex + offset];

    if (candidate) {
      context.push(candidate.original);
    }
  }

  return context;
}

function normalizeRequestedSourceLanguage(value: string | null) {
  return value && value.trim().length > 0 ? value.trim() : null;
}

function normalizeGeneratedTransliteration(original: string, value: string | null) {
  if (!value) {
    return null;
  }

  return value.trim().toLowerCase() === original.trim().toLowerCase() ? null : value;
}

async function generateDraftLinesInBatches(
  options: GenerateAiTranslationOptions,
  sourceLines: SourceDraftLine[],
  sourceLyricsKind: "synced" | "plain"
) {
  const batchSize = sourceLyricsKind === "plain" ? MAX_LINES_PER_BATCH_PLAIN : MAX_LINES_PER_BATCH_SYNCED;
  const batches = chunkSourceLines(sourceLines, batchSize);
  const generatedLines = [];
  let inferredSourceLanguage = normalizeRequestedSourceLanguage(options.sourceLanguage);
  let model = "";

  for (const batch of batches) {
    const glossaryEntries = await getAiGlossaryEntries(inferredSourceLanguage);

    const aiResponse = await requestProviderTranslationDraft({
      title: options.title,
      artist: options.artist,
      album: options.album,
      sourceLanguage: inferredSourceLanguage,
      targetLanguage: normalizeLanguage(options.targetLanguage),
      includeTransliteration: options.includeTransliteration,
      includeNotes: options.includeNotes,
      glossaryEntries,
      lines: batch.map((line) => ({
        index: line.order + 1,
        original: line.original,
        contextBefore: buildContextLines(sourceLines, line.order, -CONTEXT_WINDOW_LINES, -1),
        contextAfter: buildContextLines(sourceLines, line.order, 1, CONTEXT_WINDOW_LINES)
      }))
    });

    model = aiResponse.model;

    if (!inferredSourceLanguage) {
      inferredSourceLanguage = aiResponse.sourceLanguage;
    }

    generatedLines.push(
      ...batch.map((line, index) => ({
        order: line.order,
        original: line.original,
        translated: aiResponse.lines[index]?.translated ?? "",
        transliteration: normalizeGeneratedTransliteration(line.original, aiResponse.lines[index]?.transliteration ?? null),
        note: aiResponse.lines[index]?.note ?? null,
        startMs: line.startMs,
        endMs: line.endMs
      }))
    );
  }

  return {
    model,
    sourceLanguage: normalizeLanguage(inferredSourceLanguage ?? "Unknown"),
    lines: generatedLines
  };
}

function shouldPreserveExistingTranslationFile(kind: "missing" | "stub" | "translated" | "malformed", overwrite: boolean) {
  if (kind === "missing" || kind === "stub") {
    return false;
  }

  return !overwrite;
}

export async function generateAiTranslationDraft(
  options: GenerateAiTranslationOptions
): Promise<GenerateAiTranslationResult> {
  const lyricsCache = await getLyricsCacheByTrackId(options.spotifyTrackId);

  if (!lyricsCache) {
    return {
      status: "missing_lyrics"
    };
  }

  const sourceLines = buildSourceLines(lyricsCache);

  if (sourceLines.length === 0) {
    return {
      status: "missing_lyrics"
    };
  }

  const targetLanguage = normalizeLanguage(options.targetLanguage);
  const aiResponse = await generateDraftLinesInBatches(options, sourceLines, lyricsCache.kind);

  const draftFile = {
    spotifyTrackId: options.spotifyTrackId,
    title: options.title,
    artist: options.artist,
    album: options.album,
    durationMs: options.durationMs,
    sourceLanguage: normalizeLanguage(aiResponse.sourceLanguage),
    targetLanguage,
    generatedAt: new Date().toISOString(),
    mode: lyricsCache.kind,
    sourceLyricsKind: lyricsCache.kind,
    generator: {
      provider: getActiveAiProvider(),
      model: aiResponse.model
    },
    lines: aiResponse.lines
  };

  const draftFilePath = await writeAiTranslationDraftFile(draftFile);

  if (lyricsCache.kind === "plain") {
    return {
      status: "draft_only_plain",
      draftFilePath,
      lineCount: draftFile.lines.length
    };
  }

  const translationInspection = await inspectTranslationFile(options.spotifyTrackId);

  if (shouldPreserveExistingTranslationFile(translationInspection.kind, options.overwriteExistingTranslation)) {
    return {
      status: "draft_only_preserved",
      draftFilePath,
      translationFilePath: translationInspection.filePath,
      lineCount: draftFile.lines.length
    };
  }

  const translationFile: TrackTranslation = {
    spotifyTrackId: options.spotifyTrackId,
    title: options.title,
    artist: options.artist,
    sourceLanguage: normalizeLanguage(aiResponse.sourceLanguage),
    targetLanguage,
    lines: draftFile.lines.map((line) => ({
      startMs: line.startMs ?? 0,
      endMs: line.endMs ?? 0,
      original: line.original,
      translated: line.translated,
      transliteration: line.transliteration ?? undefined,
      note: line.note ?? undefined
    }))
  };

  const translationFilePath = await writeTrackTranslationFile(translationFile);

  return {
    status: "saved_translation",
    draftFilePath,
    translationFilePath,
    lineCount: draftFile.lines.length
  };
}
