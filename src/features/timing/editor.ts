import type { AiTranslationDraftFile } from "@/features/ai/types";
import type { LyricsCacheFile } from "@/features/lyrics/types";
import type { TimingEditorDocument, TimingEditorLine } from "@/features/timing/types";
import type { TrackTranslation, TranslationLine } from "@/features/translations/types";

const DEFAULT_LINE_DURATION_MS = 4_000;
const MIN_ESTIMATED_LINE_WEIGHT = 1;

export function formatTimingInput(ms: number | null) {
  if (ms === null || !Number.isFinite(ms)) {
    return "";
  }

  const safeMs = Math.max(0, Math.floor(ms));
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1_000);
  const hundredths = Math.floor((safeMs % 1_000) / 10);

  return `${minutes}:${seconds.toString().padStart(2, "0")}.${hundredths.toString().padStart(2, "0")}`;
}

export function parseTimingInput(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  const minuteSecondMatch = trimmed.match(/^(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?$/);

  if (!minuteSecondMatch) {
    return null;
  }

  const minutes = Number.parseInt(minuteSecondMatch[1] ?? "0", 10);
  const seconds = Number.parseInt(minuteSecondMatch[2] ?? "0", 10);
  const fraction = minuteSecondMatch[3] ?? "";
  const milliseconds =
    fraction.length === 3 ? Number.parseInt(fraction, 10) : fraction.length === 2 ? Number.parseInt(fraction, 10) * 10 : fraction.length === 1 ? Number.parseInt(fraction, 10) * 100 : 0;

  return minutes * 60_000 + seconds * 1_000 + milliseconds;
}

function buildTimingLinesFromTranslation(translation: TrackTranslation) {
  return translation.lines.map((line, index) => ({
    order: index,
    original: line.original,
    translated: line.translated,
    transliteration: line.transliteration ?? null,
    note: line.note ?? null,
    startMs: line.startMs,
    endMs: line.endMs
  })) satisfies TimingEditorLine[];
}

function buildTimingLinesFromAiDraft(draftFile: AiTranslationDraftFile) {
  return draftFile.lines.map((line) => ({
    order: line.order,
    original: line.original,
    translated: line.translated,
    transliteration: line.transliteration,
    note: line.note,
    startMs: line.startMs,
    endMs: line.endMs
  })) satisfies TimingEditorLine[];
}

function buildTimingLinesFromLyricsCache(cacheFile: LyricsCacheFile) {
  if (cacheFile.kind === "synced") {
    return cacheFile.lines.map((line, index) => {
      const nextStartMs = cacheFile.lines[index + 1]?.startMs ?? cacheFile.durationMs;
      return {
        order: index,
        original: line.text,
        translated: "",
        transliteration: null,
        note: null,
        startMs: line.startMs,
        endMs: Math.max(line.startMs, nextStartMs - 1)
      };
    }) satisfies TimingEditorLine[];
  }

  return (cacheFile.plainLyrics ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      order: index,
      original: line,
      translated: "",
      transliteration: null,
      note: null,
      startMs: null,
      endMs: null
    })) satisfies TimingEditorLine[];
}

export function buildTimingEditorDocument(options: {
  spotifyTrackId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  translation: TrackTranslation | null;
  aiDraft: AiTranslationDraftFile | null;
  lyricsCache: LyricsCacheFile | null;
}) {
  if (options.translation) {
    return {
      spotifyTrackId: options.spotifyTrackId,
      title: options.title,
      artist: options.artist,
      album: options.album,
      durationMs: options.durationMs,
      sourceLanguage: options.translation.sourceLanguage,
      targetLanguage: options.translation.targetLanguage,
      source: "translation",
      lines: buildTimingLinesFromTranslation(options.translation)
    } satisfies TimingEditorDocument;
  }

  if (options.aiDraft) {
    return {
      spotifyTrackId: options.spotifyTrackId,
      title: options.title,
      artist: options.artist,
      album: options.album,
      durationMs: options.durationMs,
      sourceLanguage: options.aiDraft.sourceLanguage,
      targetLanguage: options.aiDraft.targetLanguage,
      source: "ai_draft",
      lines: buildTimingLinesFromAiDraft(options.aiDraft)
    } satisfies TimingEditorDocument;
  }

  if (options.lyricsCache) {
    return {
      spotifyTrackId: options.spotifyTrackId,
      title: options.title,
      artist: options.artist,
      album: options.album,
      durationMs: options.durationMs,
      sourceLanguage: options.lyricsCache.language ?? "Unknown",
      targetLanguage: "English",
      source: "lyrics_cache",
      lines: buildTimingLinesFromLyricsCache(options.lyricsCache)
    } satisfies TimingEditorDocument;
  }

  return null;
}

function getTimingWeightText(line: TimingEditorLine) {
  const candidate = `${line.original} ${line.translated}`.trim();
  return candidate.replace(/\[[^\]]+\]/g, " ").replace(/\s+/g, " ").trim();
}

function estimateTimingWeight(line: TimingEditorLine) {
  const weightText = getTimingWeightText(line);
  const compactTextLength = weightText.replace(/\s+/g, "").length;
  const wordCount = weightText ? weightText.split(" ").filter(Boolean).length : 0;

  return Math.max(MIN_ESTIMATED_LINE_WEIGHT, 1 + wordCount * 1.6 + compactTextLength / 18);
}

function cloneTimingLines(lines: TimingEditorLine[]) {
  return lines.map((line) => ({ ...line }));
}

function fillEstimatedRange(options: {
  lines: TimingEditorLine[];
  startIndex: number;
  endIndex: number;
  startBoundaryMs: number;
  endBoundaryMs: number;
}) {
  const { lines, startIndex, endIndex } = options;

  if (startIndex > endIndex) {
    return;
  }

  const untimedIndexes: number[] = [];

  for (let index = startIndex; index <= endIndex; index += 1) {
    if (lines[index] && lines[index].startMs === null) {
      untimedIndexes.push(index);
    }
  }

  if (untimedIndexes.length === 0) {
    return;
  }

  const startBoundaryMs = Math.max(0, Math.floor(options.startBoundaryMs));
  const endBoundaryMs = Math.max(startBoundaryMs, Math.floor(options.endBoundaryMs));
  const segmentDurationMs = Math.max(0, endBoundaryMs - startBoundaryMs);
  const weights = untimedIndexes.map((index) => estimateTimingWeight(lines[index]!));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  let cursorMs = startBoundaryMs;

  untimedIndexes.forEach((lineIndex, arrayIndex) => {
    const line = lines[lineIndex];

    if (!line) {
      return;
    }

    line.startMs = Math.max(0, Math.floor(cursorMs));

    const lineDurationMs = totalWeight > 0 ? segmentDurationMs * ((weights[arrayIndex] ?? 0) / totalWeight) : 0;
    cursorMs += lineDurationMs;
  });
}

function deriveEstimatedEndTimes(lines: TimingEditorLine[], durationMs: number) {
  return lines.map((line, index) => {
    if (line.startMs === null) {
      return {
        ...line,
        endMs: null
      };
    }

    const nextStartMs =
      lines
        .slice(index + 1)
        .map((nextLine) => nextLine.startMs)
        .find((value): value is number => value !== null && value !== undefined) ?? durationMs;

    return {
      ...line,
      endMs: Math.max(line.startMs, Math.min(durationMs, nextStartMs - 1))
    };
  });
}

export function rebuildTimingRangesFromStarts(lines: TimingEditorLine[], durationMs: number) {
  return deriveEstimatedEndTimes(cloneTimingLines(lines), durationMs);
}

// Auto-timing preserves any start times you already set, then interpolates the untimed gaps around those anchors.
export function autoTimeTimingLines(lines: TimingEditorLine[], durationMs: number) {
  if (lines.length === 0) {
    return [];
  }

  const nextLines = cloneTimingLines(lines);
  const anchorIndexes = nextLines.reduce<number[]>((indexes, line, index) => {
    if (line.startMs !== null) {
      indexes.push(index);
    }

    return indexes;
  }, []);

  if (anchorIndexes.length === 0) {
    fillEstimatedRange({
      lines: nextLines,
      startIndex: 0,
      endIndex: nextLines.length - 1,
      startBoundaryMs: 0,
      endBoundaryMs: durationMs
    });

    return rebuildTimingRangesFromStarts(nextLines, durationMs);
  }

  fillEstimatedRange({
    lines: nextLines,
    startIndex: 0,
    endIndex: (anchorIndexes[0] ?? 0) - 1,
    startBoundaryMs: 0,
    endBoundaryMs: nextLines[anchorIndexes[0] ?? 0]?.startMs ?? 0
  });

  for (let anchorPosition = 0; anchorPosition < anchorIndexes.length - 1; anchorPosition += 1) {
    const currentAnchorIndex = anchorIndexes[anchorPosition] ?? 0;
    const nextAnchorIndex = anchorIndexes[anchorPosition + 1] ?? currentAnchorIndex;

    fillEstimatedRange({
      lines: nextLines,
      startIndex: currentAnchorIndex + 1,
      endIndex: nextAnchorIndex - 1,
      startBoundaryMs: nextLines[currentAnchorIndex]?.startMs ?? 0,
      endBoundaryMs: nextLines[nextAnchorIndex]?.startMs ?? durationMs
    });
  }

  const lastAnchorIndex = anchorIndexes[anchorIndexes.length - 1] ?? 0;
  fillEstimatedRange({
    lines: nextLines,
    startIndex: lastAnchorIndex + 1,
    endIndex: nextLines.length - 1,
    startBoundaryMs: nextLines[lastAnchorIndex]?.startMs ?? 0,
    endBoundaryMs: durationMs
  });

  return rebuildTimingRangesFromStarts(nextLines, durationMs);
}

function normalizeOptionalText(value: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function deriveEndMs(lines: TimingEditorLine[], index: number, durationMs: number) {
  const currentLine = lines[index];

  if (currentLine.endMs !== null) {
    return currentLine.endMs;
  }

  for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
    const nextStartMs = lines[nextIndex]?.startMs;

    if (nextStartMs !== null && nextStartMs !== undefined) {
      return Math.max(currentLine.startMs ?? 0, nextStartMs - 1);
    }
  }

  const fallbackStart = currentLine.startMs ?? 0;
  return Math.max(fallbackStart, Math.min(durationMs, fallbackStart + DEFAULT_LINE_DURATION_MS));
}

export function buildTrackTranslationFromTimingEditor(document: TimingEditorDocument) {
  const timedLines = document.lines
    .filter((line) => line.startMs !== null && line.translated.trim().length > 0)
    .sort((left, right) => (left.startMs ?? 0) - (right.startMs ?? 0))
    .map((line, index, lines) => {
      const startMs = Math.max(0, line.startMs ?? 0);
      const derivedEndMs = deriveEndMs(lines, index, document.durationMs);
      const endMs = Math.max(startMs, Math.min(document.durationMs, derivedEndMs));

      return {
        startMs,
        endMs,
        original: line.original,
        translated: line.translated.trim(),
        transliteration: normalizeOptionalText(line.transliteration),
        note: normalizeOptionalText(line.note)
      } satisfies TranslationLine;
    });

  if (timedLines.length === 0) {
    throw new Error("Add at least one line start time before saving the timed translation.");
  }

  const translation: TrackTranslation = {
    spotifyTrackId: document.spotifyTrackId,
    title: document.title,
    artist: document.artist,
    sourceLanguage: document.sourceLanguage.trim() || "Unknown",
    targetLanguage: document.targetLanguage.trim() || "English",
    lines: timedLines
  };

  return {
    translation,
    savedLineCount: timedLines.length,
    skippedLineCount: document.lines.length - timedLines.length
  };
}
