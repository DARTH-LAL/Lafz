import { getAiGlossaryEntries } from "@/features/ai/glossary";
import {
  getActiveAiProvider,
  requestProviderTranslationDraft,
  requestProviderTranslationRefinement
} from "@/features/ai/provider";
import { writeAiTranslationDraftFile } from "@/features/ai/repository";
import type { AiDraftLine, GenerateAiTranslationOptions, GenerateAiTranslationResult } from "@/features/ai/types";
import { getLyricsCacheByTrackId } from "@/features/lyrics/repository";
import type { LyricsCacheFile } from "@/features/lyrics/types";
import { inspectTranslationFile } from "@/features/translations/inspection";
import { writeTrackTranslationFile } from "@/features/translations/repository";
import type { TrackTranslation } from "@/features/translations/types";

const CONTEXT_WINDOW_LINES = 2;
const REFINEMENT_CONTEXT_WINDOW_LINES = 2;

function getInitialBatchSize(sourceLyricsKind: "synced" | "plain") {
  if (getActiveAiProvider() === "openai") {
    return sourceLyricsKind === "plain" ? 4 : 12;
  }

  return sourceLyricsKind === "plain" ? 1 : 6;
}

function getRefinementBatchSize(sourceLyricsKind: "synced" | "plain") {
  if (getActiveAiProvider() === "openai") {
    return sourceLyricsKind === "plain" ? 8 : 18;
  }

  return sourceLyricsKind === "plain" ? 4 : 8;
}

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

function normalizeLineKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function filterRelevantGlossaryEntries(
  glossaryEntries: Awaited<ReturnType<typeof getAiGlossaryEntries>>,
  lineTexts: string[]
) {
  if (glossaryEntries.length <= 12) {
    return glossaryEntries;
  }

  const normalizedText = lineTexts.map(normalizeLineKey).join(" ");
  const relevantEntries = glossaryEntries.filter((entry) => normalizedText.includes(normalizeLineKey(entry.term)));

  return relevantEntries.length > 0 ? relevantEntries : glossaryEntries.slice(0, 12);
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

function buildRefinementContext(lines: AiDraftLine[], centerIndex: number, startOffset: number, endOffset: number) {
  const context: Array<{
    original: string;
    chosen: string;
  }> = [];

  for (let offset = startOffset; offset <= endOffset; offset += 1) {
    if (offset === 0) {
      continue;
    }

    const candidate = lines[centerIndex + offset];

    if (candidate) {
      context.push({
        original: candidate.original,
        chosen: candidate.chosen
      });
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

function alignDraftLinesToSource(sourceLines: SourceDraftLine[], draftLines: AiDraftLine[]) {
  return sourceLines.map((sourceLine, index) => {
    const draftLine = draftLines[index];

    return {
      order: sourceLine.order,
      original: sourceLine.original,
      literal: draftLine?.literal ?? "",
      natural: draftLine?.natural ?? "",
      chosen: draftLine?.chosen ?? draftLine?.translated ?? "",
      translated: draftLine?.chosen ?? draftLine?.translated ?? "",
      transliteration: normalizeGeneratedTransliteration(sourceLine.original, draftLine?.transliteration ?? null),
      note: draftLine?.note ?? null,
      ambiguity: draftLine?.ambiguity ?? null,
      confidence: draftLine?.confidence ?? "medium",
      startMs: sourceLine.startMs,
      endMs: sourceLine.endMs
    } satisfies AiDraftLine;
  });
}

function applyDuplicateLineReuse(lines: AiDraftLine[]) {
  const firstSeenByKey = new Map<string, AiDraftLine>();

  return lines.map((line) => {
    const key = normalizeLineKey(line.original);

    if (!key) {
      return line;
    }

    const firstSeen = firstSeenByKey.get(key);

    if (!firstSeen) {
      firstSeenByKey.set(key, line);
      return line;
    }

    return {
      ...line,
      literal: firstSeen.literal,
      natural: firstSeen.natural,
      chosen: firstSeen.chosen,
      translated: firstSeen.chosen,
      transliteration: firstSeen.transliteration,
      note: firstSeen.note,
      ambiguity: firstSeen.ambiguity,
      confidence: firstSeen.confidence
    } satisfies AiDraftLine;
  });
}

async function generateDraftLinesInBatches(
  options: GenerateAiTranslationOptions,
  sourceLines: SourceDraftLine[],
  sourceLyricsKind: "synced" | "plain"
) {
  const batchSize = getInitialBatchSize(sourceLyricsKind);
  const batches = chunkSourceLines(sourceLines, batchSize);
  const generatedLines: AiDraftLine[] = [];
  let inferredSourceLanguage = normalizeRequestedSourceLanguage(options.sourceLanguage);
  let model = "";

  for (const batch of batches) {
    const loadedGlossaryEntries = await getAiGlossaryEntries({
      language: inferredSourceLanguage,
      artist: options.artist,
      spotifyTrackId: options.spotifyTrackId
    });
    const glossaryEntries = filterRelevantGlossaryEntries(
      loadedGlossaryEntries,
      batch.flatMap((line) => [
        line.original,
        ...buildContextLines(sourceLines, line.order, -CONTEXT_WINDOW_LINES, -1),
        ...buildContextLines(sourceLines, line.order, 1, CONTEXT_WINDOW_LINES)
      ])
    );

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
        literal: aiResponse.lines[index]?.literal ?? aiResponse.lines[index]?.translated ?? "",
        natural: aiResponse.lines[index]?.natural ?? aiResponse.lines[index]?.translated ?? "",
        chosen: aiResponse.lines[index]?.chosen ?? aiResponse.lines[index]?.translated ?? "",
        translated: aiResponse.lines[index]?.chosen ?? aiResponse.lines[index]?.translated ?? "",
        transliteration: normalizeGeneratedTransliteration(line.original, aiResponse.lines[index]?.transliteration ?? null),
        note: aiResponse.lines[index]?.note ?? null,
        ambiguity: aiResponse.lines[index]?.ambiguity ?? null,
        confidence: aiResponse.lines[index]?.confidence ?? "medium",
        startMs: line.startMs,
        endMs: line.endMs
      }))
    );
  }

  return {
    model,
    sourceLanguage: normalizeLanguage(inferredSourceLanguage ?? "Unknown"),
    lines: alignDraftLinesToSource(sourceLines, applyDuplicateLineReuse(generatedLines))
  };
}

async function refineDraftLinesInBatches(
  options: GenerateAiTranslationOptions,
  sourceLines: SourceDraftLine[],
  draftLines: AiDraftLine[],
  sourceLyricsKind: "synced" | "plain",
  sourceLanguage: string
) {
  const batchSize = getRefinementBatchSize(sourceLyricsKind);
  const batches = chunkSourceLines(sourceLines, batchSize);
  const refinedLines: AiDraftLine[] = [];
  let model = "";

  for (const batch of batches) {
    const batchDraftLines = batch.map((line) => draftLines[line.order]).filter((line): line is AiDraftLine => Boolean(line));

    const loadedGlossaryEntries = await getAiGlossaryEntries({
      language: sourceLanguage,
      artist: options.artist,
      spotifyTrackId: options.spotifyTrackId
    });
    const glossaryEntries = filterRelevantGlossaryEntries(
      loadedGlossaryEntries,
      batch.flatMap((line) => [
        line.original,
        ...buildContextLines(sourceLines, line.order, -REFINEMENT_CONTEXT_WINDOW_LINES, -1),
        ...buildContextLines(sourceLines, line.order, 1, REFINEMENT_CONTEXT_WINDOW_LINES),
        draftLines[line.order]?.chosen ?? "",
        draftLines[line.order]?.literal ?? "",
        draftLines[line.order]?.natural ?? ""
      ])
    );

    const aiResponse = await requestProviderTranslationRefinement({
      title: options.title,
      artist: options.artist,
      album: options.album,
      sourceLanguage,
      targetLanguage: normalizeLanguage(options.targetLanguage),
      includeTransliteration: options.includeTransliteration,
      includeNotes: options.includeNotes,
      glossaryEntries,
      lines: batchDraftLines.map((line) => ({
        index: line.order + 1,
        original: line.original,
        literal: line.literal,
        natural: line.natural,
        chosen: line.chosen,
        ambiguity: line.ambiguity,
        confidence: line.confidence,
        contextBefore: buildRefinementContext(draftLines, line.order, -REFINEMENT_CONTEXT_WINDOW_LINES, -1),
        contextAfter: buildRefinementContext(draftLines, line.order, 1, REFINEMENT_CONTEXT_WINDOW_LINES)
      }))
    });

    model = aiResponse.model || model;

    refinedLines.push(
      ...batch.map((line, index) => ({
        order: line.order,
        original: line.original,
        literal: aiResponse.lines[index]?.literal ?? draftLines[line.order]?.literal ?? "",
        natural: aiResponse.lines[index]?.natural ?? draftLines[line.order]?.natural ?? "",
        chosen:
          aiResponse.lines[index]?.chosen ??
          aiResponse.lines[index]?.translated ??
          draftLines[line.order]?.chosen ??
          "",
        translated:
          aiResponse.lines[index]?.chosen ??
          aiResponse.lines[index]?.translated ??
          draftLines[line.order]?.chosen ??
          "",
        transliteration: normalizeGeneratedTransliteration(
          line.original,
          aiResponse.lines[index]?.transliteration ?? draftLines[line.order]?.transliteration ?? null
        ),
        note: aiResponse.lines[index]?.note ?? draftLines[line.order]?.note ?? null,
        ambiguity: aiResponse.lines[index]?.ambiguity ?? draftLines[line.order]?.ambiguity ?? null,
        confidence: aiResponse.lines[index]?.confidence ?? draftLines[line.order]?.confidence ?? "medium",
        startMs: line.startMs,
        endMs: line.endMs
      }))
    );
  }

  return {
    model,
    lines: alignDraftLinesToSource(sourceLines, applyDuplicateLineReuse(refinedLines))
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
  const initialDraft = await generateDraftLinesInBatches(options, sourceLines, lyricsCache.kind);
  const refinedDraft = await refineDraftLinesInBatches(
    options,
    sourceLines,
    initialDraft.lines,
    lyricsCache.kind,
    initialDraft.sourceLanguage
  ).catch(() => null);
  const aiResponse = {
    model: refinedDraft?.model || initialDraft.model,
    sourceLanguage: initialDraft.sourceLanguage,
    lines: refinedDraft?.lines ?? initialDraft.lines
  };

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
      translated: line.chosen,
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
