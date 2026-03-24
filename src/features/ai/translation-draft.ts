import { getAiArtistMemory } from "@/features/ai/artist-memory";
import { getTrackCorrectionExamples } from "@/features/ai/correction-memory";
import { getAiGlossaryEntries, getGlossarySearchTerms, type AiGlossaryEntry } from "@/features/ai/glossary";
import {
  getActiveAiProvider,
  requestProviderMeaningAnalysis,
  requestProviderSongContext,
  requestProviderTranslationDraft,
  requestProviderTranslationRefinement,
  requestProviderTranslationSelection
} from "@/features/ai/provider";
import { normalizeLookupText, normalizeRomanizedText, tokenizeNormalizedRomanizedText } from "@/features/ai/romanized-normalization";
import { writeAiTranslationDraftFile } from "@/features/ai/repository";
import type {
  AiDraftLine,
  AiCorrectionExample,
  AiCorrectionHint,
  AiSongContext,
  AiTranslationDraftFile,
  GenerateAiTranslationOptions,
  GenerateAiTranslationResult,
  MeaningAnalysisLine
} from "@/features/ai/types";
import { getLyricsCacheByTrackId } from "@/features/lyrics/repository";
import type { LyricsCacheFile } from "@/features/lyrics/types";
import { inspectTranslationFile } from "@/features/translations/inspection";
import { writeTrackTranslationFile } from "@/features/translations/repository";
import type { TrackTranslation } from "@/features/translations/types";

const CONTEXT_WINDOW_LINES = 2;
const REFINEMENT_CONTEXT_WINDOW_LINES = 2;
const SONG_CONTEXT_MAX_LINES = 24;
const MAX_GROUP_LINES = 4;
const SYNCED_GROUP_BREAK_GAP_MS = 12_000;
const LARGE_TRACK_LINE_COUNT = 56;
const VERY_LARGE_TRACK_LINE_COUNT = 84;

function getInitialBatchSize(sourceLyricsKind: "synced" | "plain", totalLineCount: number) {
  if (getActiveAiProvider() === "openai") {
    if (sourceLyricsKind === "plain") {
      return totalLineCount >= LARGE_TRACK_LINE_COUNT ? 8 : 4;
    }

    if (totalLineCount >= VERY_LARGE_TRACK_LINE_COUNT) {
      return 18;
    }

    if (totalLineCount >= LARGE_TRACK_LINE_COUNT) {
      return 16;
    }

    return 12;
  }

  if (sourceLyricsKind === "plain") {
    return totalLineCount >= LARGE_TRACK_LINE_COUNT ? 2 : 1;
  }

  return totalLineCount >= LARGE_TRACK_LINE_COUNT ? 10 : 6;
}

function getRefinementBatchSize(sourceLyricsKind: "synced" | "plain", totalLineCount: number) {
  if (getActiveAiProvider() === "openai") {
    if (sourceLyricsKind === "plain") {
      return totalLineCount >= LARGE_TRACK_LINE_COUNT ? 16 : 8;
    }

    if (totalLineCount >= VERY_LARGE_TRACK_LINE_COUNT) {
      return 40;
    }

    if (totalLineCount >= LARGE_TRACK_LINE_COUNT) {
      return 30;
    }

    return 18;
  }

  if (sourceLyricsKind === "plain") {
    return totalLineCount >= LARGE_TRACK_LINE_COUNT ? 6 : 4;
  }

  return totalLineCount >= LARGE_TRACK_LINE_COUNT ? 12 : 8;
}

function getSelectionBatchSize(sourceLyricsKind: "synced" | "plain", totalLineCount: number) {
  if (getActiveAiProvider() === "openai") {
    if (sourceLyricsKind === "plain") {
      return totalLineCount >= LARGE_TRACK_LINE_COUNT ? 18 : 10;
    }

    if (totalLineCount >= VERY_LARGE_TRACK_LINE_COUNT) {
      return 28;
    }

    if (totalLineCount >= LARGE_TRACK_LINE_COUNT) {
      return 24;
    }

    return 20;
  }

  if (sourceLyricsKind === "plain") {
    return totalLineCount >= LARGE_TRACK_LINE_COUNT ? 6 : 4;
  }

  return totalLineCount >= LARGE_TRACK_LINE_COUNT ? 12 : 8;
}

function shouldSkipRefinement(sourceLyricsKind: "synced" | "plain", totalLineCount: number) {
  if (getActiveAiProvider() === "openai") {
    return sourceLyricsKind === "synced" && totalLineCount >= LARGE_TRACK_LINE_COUNT;
  }

  return totalLineCount >= LARGE_TRACK_LINE_COUNT;
}

function getDraftContextWindowLines(totalLineCount: number) {
  return totalLineCount >= LARGE_TRACK_LINE_COUNT ? 1 : CONTEXT_WINDOW_LINES;
}

function getRefinementContextWindowLines(totalLineCount: number) {
  return totalLineCount >= LARGE_TRACK_LINE_COUNT ? 1 : REFINEMENT_CONTEXT_WINDOW_LINES;
}

function shouldIncludeGroupText(sourceLyricsKind: "synced" | "plain", totalLineCount: number) {
  return sourceLyricsKind === "plain" || totalLineCount < LARGE_TRACK_LINE_COUNT;
}

type SourceDraftLine = {
  order: number;
  original: string;
  startMs: number | null;
  endMs: number | null;
};

type NormalizedSourceLine = {
  canonical: string;
  notes: string[];
};

type SourceLineGroup = {
  index: number;
  lineOrders: number[];
  text: string;
};

type CorrectionExampleWithSource = AiCorrectionExample & {
  source: AiCorrectionHint["source"];
};

function buildNormalizedSourceLineLookup(lines: SourceDraftLine[]) {
  return new Map<number, NormalizedSourceLine>(
    lines.map((line) => {
      const normalized = normalizeRomanizedText(line.original);

      return [
        line.order,
        {
          canonical: normalized.canonical,
          notes: normalized.notes
        }
      ] satisfies [number, NormalizedSourceLine];
    })
  );
}

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

function buildSourceLineGroups(lines: SourceDraftLine[], sourceLyricsKind: "synced" | "plain") {
  const groups: SourceLineGroup[] = [];
  let currentGroupLines: SourceDraftLine[] = [];

  const pushGroup = () => {
    if (currentGroupLines.length === 0) {
      return;
    }

    groups.push({
      index: groups.length,
      lineOrders: currentGroupLines.map((line) => line.order),
      text: currentGroupLines.map((line) => line.original).join("\n")
    });
    currentGroupLines = [];
  };

  for (const line of lines) {
    const previousLine = currentGroupLines[currentGroupLines.length - 1] ?? null;
    const shouldBreakByGap =
      sourceLyricsKind === "synced" &&
      typeof previousLine?.startMs === "number" &&
      typeof line.startMs === "number" &&
      line.startMs - previousLine.startMs >= SYNCED_GROUP_BREAK_GAP_MS;
    const shouldBreakBySize = currentGroupLines.length >= MAX_GROUP_LINES;

    if (currentGroupLines.length > 0 && (shouldBreakByGap || shouldBreakBySize)) {
      pushGroup();
    }

    currentGroupLines.push(line);
  }

  pushGroup();
  return groups;
}

function buildLineGroupLookup(groups: SourceLineGroup[]) {
  const lookup = new Map<number, SourceLineGroup>();

  for (const group of groups) {
    for (const lineOrder of group.lineOrders) {
      lookup.set(lineOrder, group);
    }
  }

  return lookup;
}

function chunkSourceLines(lines: SourceDraftLine[], chunkSize: number) {
  const chunks: SourceDraftLine[][] = [];

  for (let index = 0; index < lines.length; index += chunkSize) {
    chunks.push(lines.slice(index, index + chunkSize));
  }

  return chunks;
}

function buildSourceLinesFromDraft(draft: AiTranslationDraftFile) {
  return [...draft.lines]
    .sort((left, right) => left.order - right.order)
    .map((line) => ({
      order: line.order,
      original: line.original,
      startMs: line.startMs,
      endMs: line.endMs
    }));
}

function normalizeLineKey(value: string) {
  return normalizeLookupText(value);
}

function tokenizeNormalizedLine(value: string) {
  return tokenizeNormalizedRomanizedText(value);
}

function scoreCorrectionSimilarity(candidateText: string, correctionOriginal: string) {
  const normalizedCandidate = normalizeLineKey(candidateText);
  const normalizedCorrection = normalizeLineKey(correctionOriginal);

  if (!normalizedCandidate || !normalizedCorrection) {
    return null;
  }

  if (normalizedCandidate === normalizedCorrection) {
    return {
      score: 1_000,
      similarity: "exact" as const
    };
  }

  const candidateTokens = new Set(tokenizeNormalizedLine(candidateText));
  const correctionTokens = new Set(tokenizeNormalizedLine(correctionOriginal));
  const candidateBigrams = new Set(
    Array.from(candidateTokens)
      .map((token, index, tokens) => (index < tokens.length - 1 ? `${tokens[index]} ${tokens[index + 1]}` : null))
      .filter((token): token is string => Boolean(token))
  );
  const correctionBigrams = new Set(
    Array.from(correctionTokens)
      .map((token, index, tokens) => (index < tokens.length - 1 ? `${tokens[index]} ${tokens[index + 1]}` : null))
      .filter((token): token is string => Boolean(token))
  );

  if (candidateTokens.size === 0 || correctionTokens.size === 0) {
    return null;
  }

  const sharedTokens = Array.from(correctionTokens).filter((token) => candidateTokens.has(token));
  const sharedCount = sharedTokens.length;
  const sharedBigrams = Array.from(correctionBigrams).filter((token) => candidateBigrams.has(token)).length;

  if (sharedCount === 0) {
    return null;
  }

  const correctionCoverage = sharedCount / correctionTokens.size;
  const candidateCoverage = sharedCount / candidateTokens.size;
  const unionCount = new Set([...candidateTokens, ...correctionTokens]).size;
  const jaccard = unionCount > 0 ? sharedCount / unionCount : 0;
  const containsOther =
    normalizedCandidate.includes(normalizedCorrection) || normalizedCorrection.includes(normalizedCandidate);
  const phraseLengthBonus = Math.min(correctionTokens.size, 6);
  const score =
    (containsOther ? 120 : 0) +
    Math.round(correctionCoverage * 100) +
    Math.round(candidateCoverage * 60) +
    Math.round(jaccard * 50) +
    Math.min(sharedBigrams * 18, 54) +
    phraseLengthBonus;

  if (containsOther && correctionCoverage >= 0.75) {
    return {
      score,
      similarity: "high" as const
    };
  }

  if (
    correctionCoverage >= 0.75 ||
    jaccard >= 0.6 ||
    sharedBigrams >= 1 ||
    (correctionCoverage >= 0.6 && candidateCoverage >= 0.6)
  ) {
    return {
      score,
      similarity: "high" as const
    };
  }

  if (correctionCoverage >= 0.5 || (sharedCount >= 2 && jaccard >= 0.35)) {
    return {
      score,
      similarity: "medium" as const
    };
  }

  return null;
}

function mergeCorrectionExampleSources(lists: CorrectionExampleWithSource[][]) {
  const merged = new Map<string, CorrectionExampleWithSource>();

  for (const list of lists) {
    for (const example of list) {
      const originalKey = normalizeLineKey(example.original);
      const chosenKey = normalizeLineKey(example.chosen);

      if (!originalKey || !chosenKey) {
        continue;
      }

      merged.set(`${example.source}:${originalKey}:${chosenKey}`, example);
    }
  }

  return Array.from(merged.values());
}

function buildMatchingCorrectionHints(
  correctionExamples: CorrectionExampleWithSource[],
  candidateTexts: string[],
  maxHints = 3
): AiCorrectionHint[] {
  const seen = new Set<string>();

  return correctionExamples
    .map((example) => {
      const bestMatch = candidateTexts.reduce<{ score: number; similarity: AiCorrectionHint["similarity"] } | null>(
        (currentBest, candidateText) => {
          const score = scoreCorrectionSimilarity(candidateText, example.original);

          if (!score) {
            return currentBest;
          }

          if (!currentBest || score.score > currentBest.score) {
            return score;
          }

          return currentBest;
        },
        null
      );

      if (!bestMatch) {
        return null;
      }

      return {
        original: example.original,
        chosen: example.chosen,
        note: example.note ?? null,
        source: example.source,
        similarity: bestMatch.similarity,
        _score: bestMatch.score
      };
    })
    .filter(
      (
        hint
      ): hint is AiCorrectionHint & {
        _score: number;
      } => Boolean(hint)
    )
    .sort((left, right) => right._score - left._score)
    .filter((hint) => {
      const key = `${normalizeLineKey(hint.original)}:${normalizeLineKey(hint.chosen)}`;

      if (!key || seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, maxHints)
    .map(({ _score: _ignored, ...hint }) => hint);
}

function normalizeRequestedSourceLanguage(value: string | null) {
  return value && value.trim().length > 0 ? value.trim() : null;
}

function mergeGlossaryEntries(glossaryLists: AiGlossaryEntry[][]) {
  const merged = new Map<string, AiGlossaryEntry>();

  for (const glossaryList of glossaryLists) {
    for (const entry of glossaryList) {
      const key = normalizeLineKey(entry.term);
      if (!key) {
        continue;
      }

      merged.set(key, entry);
    }
  }

  return Array.from(merged.values());
}

function getGlossaryCategoryWeight(category: AiGlossaryEntry["category"]) {
  switch (category) {
    case "preferred_rendering":
      return 8;
    case "phrase":
      return 7;
    case "idiom":
      return 6;
    case "slang":
      return 5;
    case "reference":
      return 4;
    default:
      return 2;
  }
}

function filterRelevantGlossaryEntries(glossaryEntries: AiGlossaryEntry[], lineTexts: string[]) {
  if (glossaryEntries.length <= 16) {
    return glossaryEntries;
  }

  const normalizedText = lineTexts.map(normalizeLineKey).join(" ");

  const scoredEntries = glossaryEntries.map((entry) => {
    const normalizedTerms = getGlossarySearchTerms(entry);
    const allTermWords = normalizedTerms.flatMap((term) => term.split(" ").filter(Boolean));
    const hasExactMatch = normalizedTerms.some((term) => term.length > 0 && normalizedText.includes(term));
    const partialMatchCount = allTermWords.filter((word) => normalizedText.includes(word)).length;
    const score =
      (hasExactMatch ? 100 : 0) +
      partialMatchCount * 10 +
      getGlossaryCategoryWeight(entry.category) +
      Math.min(allTermWords.length, 4);

    return {
      entry,
      score,
      hasExactMatch
    };
  });

  const matchedEntries = scoredEntries
    .filter((item) => item.hasExactMatch || item.score >= 15)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.entry);

  if (matchedEntries.length >= 12) {
    return matchedEntries.slice(0, 18);
  }

  const fallbackEntries = scoredEntries
    .sort((left, right) => right.score - left.score)
    .map((item) => item.entry)
    .slice(0, 12);

  return mergeGlossaryEntries([matchedEntries, fallbackEntries]).slice(0, 18);
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

function normalizeGeneratedTransliteration(original: string, value: string | null) {
  if (!value) {
    return null;
  }

  return value.trim().toLowerCase() === original.trim().toLowerCase() ? null : value;
}

function alignDraftLinesToSource(
  sourceLines: SourceDraftLine[],
  draftLines: AiDraftLine[],
  normalizedSourceLookup?: Map<number, NormalizedSourceLine>
) {
  return sourceLines.map((sourceLine, index) => {
    const draftLine = draftLines[index];
    const normalizedLine = normalizedSourceLookup?.get(sourceLine.order) ?? normalizeRomanizedText(sourceLine.original);

    return {
      order: sourceLine.order,
      original: sourceLine.original,
      normalizedOriginal: draftLine?.normalizedOriginal ?? normalizedLine.canonical,
      normalizationNotes: draftLine?.normalizationNotes ?? normalizedLine.notes,
      meaning: draftLine?.meaning ?? draftLine?.literal ?? "",
      impliedMeaning: draftLine?.impliedMeaning ?? null,
      register: draftLine?.register ?? null,
      literal: draftLine?.literal ?? "",
      natural: draftLine?.natural ?? "",
      slangAware: draftLine?.slangAware ?? draftLine?.natural ?? draftLine?.literal ?? "",
      chosen: draftLine?.chosen ?? draftLine?.translated ?? "",
      translated: draftLine?.chosen ?? draftLine?.translated ?? "",
      transliteration: normalizeGeneratedTransliteration(sourceLine.original, draftLine?.transliteration ?? null),
      note: draftLine?.note ?? null,
      ambiguity: draftLine?.ambiguity ?? null,
      confidence: draftLine?.confidence ?? "medium",
      selectorReason: draftLine?.selectorReason ?? null,
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
      normalizedOriginal: firstSeen.normalizedOriginal,
      normalizationNotes: firstSeen.normalizationNotes,
      meaning: firstSeen.meaning,
      impliedMeaning: firstSeen.impliedMeaning,
      register: firstSeen.register,
      literal: firstSeen.literal,
      natural: firstSeen.natural,
      slangAware: firstSeen.slangAware,
      chosen: firstSeen.chosen,
      translated: firstSeen.chosen,
      transliteration: firstSeen.transliteration,
      note: firstSeen.note,
      ambiguity: firstSeen.ambiguity,
      confidence: firstSeen.confidence,
      selectorReason: firstSeen.selectorReason
    } satisfies AiDraftLine;
  });
}

function getChosenLineEditOrders(previousDraft: AiTranslationDraftFile, nextDraft: AiTranslationDraftFile) {
  const previousByOrder = new Map(previousDraft.lines.map((line) => [line.order, line]));

  return nextDraft.lines
    .filter((line) => {
      const previousLine = previousByOrder.get(line.order);

      if (!previousLine) {
        return false;
      }

      return previousLine.chosen.trim() !== line.chosen.trim();
    })
    .map((line) => line.order);
}

function propagateLockedDuplicateLines(draftLines: AiDraftLine[], initialLockedOrders: Set<number>) {
  const lockedByKey = new Map<string, AiDraftLine>();

  for (const line of draftLines) {
    if (!initialLockedOrders.has(line.order)) {
      continue;
    }

    const key = normalizeLineKey(line.original);

    if (!key) {
      continue;
    }

    lockedByKey.set(key, line);
  }

  const expandedLockedOrders = new Set(initialLockedOrders);
  const propagatedLines = draftLines.map((line) => {
    const key = normalizeLineKey(line.original);
    const lockedLine = key ? lockedByKey.get(key) : null;

    if (!lockedLine || lockedLine.order === line.order) {
      return line;
    }

    expandedLockedOrders.add(line.order);

    return {
      ...line,
      normalizedOriginal: lockedLine.normalizedOriginal,
      normalizationNotes: lockedLine.normalizationNotes,
      meaning: lockedLine.meaning,
      impliedMeaning: lockedLine.impliedMeaning,
      register: lockedLine.register,
      literal: lockedLine.literal,
      natural: lockedLine.natural,
      slangAware: lockedLine.slangAware,
      chosen: lockedLine.chosen,
      translated: lockedLine.chosen,
      transliteration: lockedLine.transliteration,
      note: lockedLine.note,
      ambiguity: lockedLine.ambiguity,
      confidence: lockedLine.confidence,
      selectorReason: "Matched a repeated line you already corrected."
    } satisfies AiDraftLine;
  });

  return {
    lockedOrders: expandedLockedOrders,
    lines: propagatedLines
  };
}

async function loadRelevantGlossaryEntries(options: {
  sourceLanguage: string | null;
  artist: string;
  spotifyTrackId: string;
  candidateTexts: string[];
  preferredRenderings: AiGlossaryEntry[];
}) {
  const loadedGlossaryEntries = await getAiGlossaryEntries({
    language: options.sourceLanguage,
    artist: options.artist,
    spotifyTrackId: options.spotifyTrackId
  });

  return filterRelevantGlossaryEntries(
    mergeGlossaryEntries([loadedGlossaryEntries, options.preferredRenderings]),
    options.candidateTexts
  );
}

function buildCorrectionExamplesFromDraftLines(
  draftLines: AiDraftLine[],
  orders: Set<number>,
  source: AiCorrectionHint["source"]
) {
  const correctionExamples = new Map<string, CorrectionExampleWithSource>();

  for (const line of draftLines) {
    if (!orders.has(line.order)) {
      continue;
    }

    const originalKey = normalizeLineKey(line.original);
    const chosenKey = normalizeLineKey(line.chosen);

    if (!originalKey || !chosenKey) {
      continue;
    }

    correctionExamples.set(`${source}:${originalKey}:${chosenKey}`, {
      original: line.original,
      chosen: line.chosen,
      note: line.note ?? null,
      source
    });
  }

  return Array.from(correctionExamples.values());
}

function sampleSongContextLines(sourceLines: SourceDraftLine[], maxLines = SONG_CONTEXT_MAX_LINES) {
  if (sourceLines.length <= maxLines) {
    return sourceLines;
  }

  const sampledIndexes = new Set<number>();

  for (let index = 0; index < maxLines; index += 1) {
    const scaledIndex = Math.round((index * (sourceLines.length - 1)) / Math.max(maxLines - 1, 1));
    sampledIndexes.add(scaledIndex);
  }

  return Array.from(sampledIndexes)
    .sort((left, right) => left - right)
    .map((index) => sourceLines[index])
    .filter((line): line is SourceDraftLine => Boolean(line));
}

async function generateSongContext(options: GenerateAiTranslationOptions, sourceLines: SourceDraftLine[]) {
  const requestedSourceLanguage = normalizeRequestedSourceLanguage(options.sourceLanguage);
  const { memory: artistMemory, preferredRenderings, correctionExamples: artistCorrectionExamples } =
    await getAiArtistMemory(options.artist);
  const trackCorrectionExamples = await getTrackCorrectionExamples(options.spotifyTrackId).catch(() => []);
  const sampledLines = sampleSongContextLines(
    sourceLines,
    sourceLines.length >= LARGE_TRACK_LINE_COUNT ? 14 : SONG_CONTEXT_MAX_LINES
  );
  const glossaryEntries = await loadRelevantGlossaryEntries({
    sourceLanguage: requestedSourceLanguage,
    artist: options.artist,
    spotifyTrackId: options.spotifyTrackId,
    candidateTexts: sampledLines.map((line) => line.original),
    preferredRenderings
  });

  const response = await requestProviderSongContext({
    title: options.title,
    artist: options.artist,
    album: options.album,
    sourceLanguage: requestedSourceLanguage,
    glossaryEntries,
    artistMemory,
    lines: sampledLines.map((line) => ({
      index: line.order + 1,
      original: line.original
    }))
  }).catch(() => null);

  return {
    artistMemory,
    preferredRenderings,
    artistCorrectionExamples,
    trackCorrectionExamples,
    sourceLanguage: normalizeRequestedSourceLanguage(response?.sourceLanguage ?? requestedSourceLanguage),
    songContext: response?.songContext ?? null
  };
}

async function generateMeaningLinesInBatches(
  options: GenerateAiTranslationOptions,
  sourceLines: SourceDraftLine[],
  sourceLyricsKind: "synced" | "plain",
  requestedSourceLanguage: string | null,
  songContext: AiSongContext | null,
  artistMemory: Awaited<ReturnType<typeof getAiArtistMemory>>["memory"],
  preferredRenderings: AiGlossaryEntry[],
  artistCorrectionExamples: AiCorrectionExample[],
  trackCorrectionExamples: AiCorrectionExample[],
  normalizedSourceLookup: Map<number, NormalizedSourceLine>
) {
  const batchSize = getInitialBatchSize(sourceLyricsKind, sourceLines.length);
  const batches = chunkSourceLines(sourceLines, batchSize);
  const sourceGroups = buildSourceLineGroups(sourceLines, sourceLyricsKind);
  const groupLookup = buildLineGroupLookup(sourceGroups);
  const contextWindowLines = getDraftContextWindowLines(sourceLines.length);
  const includeGroupText = shouldIncludeGroupText(sourceLyricsKind, sourceLines.length);
  const meaningLines: MeaningAnalysisLine[] = [];
  let inferredSourceLanguage = normalizeRequestedSourceLanguage(requestedSourceLanguage);
  let model = "";

  for (const batch of batches) {
    const glossaryEntries = await loadRelevantGlossaryEntries({
      sourceLanguage: inferredSourceLanguage,
      artist: options.artist,
      spotifyTrackId: options.spotifyTrackId,
      candidateTexts: batch.flatMap((line) => {
        const group = groupLookup.get(line.order);
        const normalizedLine = normalizedSourceLookup.get(line.order);

        return [
          line.original,
          normalizedLine?.canonical ?? "",
          ...buildContextLines(sourceLines, line.order, -contextWindowLines, -1),
          ...buildContextLines(sourceLines, line.order, 1, contextWindowLines),
          includeGroupText ? group?.text ?? "" : ""
        ];
      }),
      preferredRenderings
    });
    const correctionExamples = mergeCorrectionExampleSources([
      trackCorrectionExamples.map((example) => ({ ...example, source: "track_memory" as const })),
      artistCorrectionExamples.map((example) => ({ ...example, source: "artist_memory" as const }))
    ]);

    const aiResponse = await requestProviderMeaningAnalysis({
      title: options.title,
      artist: options.artist,
      album: options.album,
      sourceLanguage: inferredSourceLanguage,
      glossaryEntries,
      songContext,
      artistMemory,
      lines: batch.map((line) => {
        const group = groupLookup.get(line.order);
        const normalizedLine = normalizedSourceLookup.get(line.order);

        return {
          index: line.order + 1,
          original: line.original,
          normalizedOriginal: normalizedLine?.canonical ?? null,
          normalizationNotes: normalizedLine?.notes ?? [],
          contextBefore: buildContextLines(sourceLines, line.order, -contextWindowLines, -1),
          contextAfter: buildContextLines(sourceLines, line.order, 1, contextWindowLines),
          groupIndex: group?.index,
          groupText: includeGroupText ? group?.text : undefined,
          matchingCorrections: buildMatchingCorrectionHints(correctionExamples, [
            line.original,
            normalizedLine?.canonical ?? "",
            ...buildContextLines(sourceLines, line.order, -contextWindowLines, -1),
            ...buildContextLines(sourceLines, line.order, 1, contextWindowLines),
            includeGroupText ? group?.text ?? "" : ""
          ])
        };
      })
    });

    model = aiResponse.model;

    if (!inferredSourceLanguage) {
      inferredSourceLanguage = aiResponse.sourceLanguage;
    }

    meaningLines.push(
      ...batch.map((line, index) => ({
        meaning: aiResponse.lines[index]?.meaning ?? line.original,
        impliedMeaning: aiResponse.lines[index]?.impliedMeaning ?? null,
        register: aiResponse.lines[index]?.register ?? null
      }))
    );
  }

  return {
    model,
    sourceLanguage: normalizeLanguage(inferredSourceLanguage ?? "Unknown"),
    lines: meaningLines
  };
}

async function generateDraftLinesInBatches(
  options: GenerateAiTranslationOptions,
  sourceLines: SourceDraftLine[],
  sourceLyricsKind: "synced" | "plain",
  requestedSourceLanguage: string | null,
  songContext: AiSongContext | null,
  artistMemory: Awaited<ReturnType<typeof getAiArtistMemory>>["memory"],
  preferredRenderings: AiGlossaryEntry[],
  artistCorrectionExamples: AiCorrectionExample[],
  trackCorrectionExamples: AiCorrectionExample[],
  normalizedSourceLookup: Map<number, NormalizedSourceLine>,
  meaningLines: MeaningAnalysisLine[]
) {
  const batchSize = getInitialBatchSize(sourceLyricsKind, sourceLines.length);
  const batches = chunkSourceLines(sourceLines, batchSize);
  const sourceGroups = buildSourceLineGroups(sourceLines, sourceLyricsKind);
  const groupLookup = buildLineGroupLookup(sourceGroups);
  const contextWindowLines = getDraftContextWindowLines(sourceLines.length);
  const includeGroupText = shouldIncludeGroupText(sourceLyricsKind, sourceLines.length);
  const generatedLines: AiDraftLine[] = [];
  let inferredSourceLanguage = normalizeRequestedSourceLanguage(requestedSourceLanguage);
  let model = "";

  for (const batch of batches) {
    const glossaryEntries = await loadRelevantGlossaryEntries({
      sourceLanguage: inferredSourceLanguage,
      artist: options.artist,
      spotifyTrackId: options.spotifyTrackId,
      candidateTexts: batch.flatMap((line) => {
        const group = groupLookup.get(line.order);

        return [
          line.original,
          ...buildContextLines(sourceLines, line.order, -contextWindowLines, -1),
          ...buildContextLines(sourceLines, line.order, 1, contextWindowLines),
          includeGroupText ? group?.text ?? "" : ""
        ];
      }),
      preferredRenderings
    });
    const correctionExamples = mergeCorrectionExampleSources([
      trackCorrectionExamples.map((example) => ({ ...example, source: "track_memory" as const })),
      artistCorrectionExamples.map((example) => ({ ...example, source: "artist_memory" as const }))
    ]);

    const aiResponse = await requestProviderTranslationDraft({
      title: options.title,
      artist: options.artist,
      album: options.album,
      sourceLanguage: inferredSourceLanguage,
      targetLanguage: normalizeLanguage(options.targetLanguage),
      includeTransliteration: options.includeTransliteration,
      includeNotes: options.includeNotes,
      glossaryEntries,
      songContext,
      artistMemory,
      lines: batch.map((line) => {
        const group = groupLookup.get(line.order);
        const normalizedLine = normalizedSourceLookup.get(line.order);
        const meaningLine = meaningLines[line.order];

        return {
          index: line.order + 1,
          original: line.original,
          normalizedOriginal: normalizedLine?.canonical ?? null,
          normalizationNotes: normalizedLine?.notes ?? [],
          meaning: meaningLine?.meaning ?? line.original,
          impliedMeaning: meaningLine?.impliedMeaning ?? null,
          register: meaningLine?.register ?? null,
          contextBefore: buildContextLines(sourceLines, line.order, -contextWindowLines, -1),
          contextAfter: buildContextLines(sourceLines, line.order, 1, contextWindowLines),
          groupIndex: group?.index,
          groupText: includeGroupText ? group?.text : undefined,
          matchingCorrections: buildMatchingCorrectionHints(correctionExamples, [
            line.original,
            ...buildContextLines(sourceLines, line.order, -contextWindowLines, -1),
            ...buildContextLines(sourceLines, line.order, 1, contextWindowLines),
            includeGroupText ? group?.text ?? "" : ""
          ])
        };
      })
    });

    model = aiResponse.model;

    if (!inferredSourceLanguage) {
      inferredSourceLanguage = aiResponse.sourceLanguage;
    }

    generatedLines.push(
      ...batch.map((line, index) => ({
        order: line.order,
        original: line.original,
        normalizedOriginal: normalizedSourceLookup.get(line.order)?.canonical ?? null,
        normalizationNotes: normalizedSourceLookup.get(line.order)?.notes ?? [],
        meaning: aiResponse.lines[index]?.meaning ?? meaningLines[line.order]?.meaning ?? line.original,
        impliedMeaning: aiResponse.lines[index]?.impliedMeaning ?? meaningLines[line.order]?.impliedMeaning ?? null,
        register: aiResponse.lines[index]?.register ?? meaningLines[line.order]?.register ?? null,
        literal: aiResponse.lines[index]?.literal ?? aiResponse.lines[index]?.translated ?? "",
        natural: aiResponse.lines[index]?.natural ?? aiResponse.lines[index]?.translated ?? "",
        slangAware:
          aiResponse.lines[index]?.slangAware ??
          aiResponse.lines[index]?.natural ??
          aiResponse.lines[index]?.translated ??
          "",
        chosen: aiResponse.lines[index]?.chosen ?? aiResponse.lines[index]?.translated ?? "",
        translated: aiResponse.lines[index]?.chosen ?? aiResponse.lines[index]?.translated ?? "",
        transliteration: normalizeGeneratedTransliteration(line.original, aiResponse.lines[index]?.transliteration ?? null),
        note: aiResponse.lines[index]?.note ?? null,
        ambiguity: aiResponse.lines[index]?.ambiguity ?? null,
        confidence: aiResponse.lines[index]?.confidence ?? "medium",
        selectorReason: aiResponse.lines[index]?.selectorReason ?? null,
        startMs: line.startMs,
        endMs: line.endMs
      }))
    );
  }

  return {
    model,
    sourceLanguage: normalizeLanguage(inferredSourceLanguage ?? "Unknown"),
    lines: alignDraftLinesToSource(sourceLines, applyDuplicateLineReuse(generatedLines), normalizedSourceLookup)
  };
}

async function refineDraftLinesInBatches(
  options: GenerateAiTranslationOptions,
  sourceLines: SourceDraftLine[],
  draftLines: AiDraftLine[],
  sourceLyricsKind: "synced" | "plain",
  sourceLanguage: string,
  songContext: AiSongContext | null,
  artistMemory: Awaited<ReturnType<typeof getAiArtistMemory>>["memory"],
  preferredRenderings: AiGlossaryEntry[],
  artistCorrectionExamples: AiCorrectionExample[],
  trackCorrectionExamples: AiCorrectionExample[],
  lockedOrders?: Set<number>,
  currentSongCorrectionExamples: CorrectionExampleWithSource[] = [],
  normalizedSourceLookup?: Map<number, NormalizedSourceLine>
) {
  const batchSize = getRefinementBatchSize(sourceLyricsKind, sourceLines.length);
  const batches = chunkSourceLines(sourceLines, batchSize);
  const refinementContextWindow = getRefinementContextWindowLines(sourceLines.length);
  const refinedLines: AiDraftLine[] = [];
  let model = "";

  for (const batch of batches) {
    const unlockedBatch = batch.filter((line) => !lockedOrders?.has(line.order));

    if (unlockedBatch.length === 0) {
      refinedLines.push(
        ...batch.map((line) => ({
          ...draftLines[line.order],
          startMs: line.startMs,
          endMs: line.endMs
        }))
      );
      continue;
    }

    const batchDraftLines = unlockedBatch
      .map((line) => draftLines[line.order])
      .filter((line): line is AiDraftLine => Boolean(line));
    const glossaryEntries = await loadRelevantGlossaryEntries({
      sourceLanguage,
      artist: options.artist,
      spotifyTrackId: options.spotifyTrackId,
      candidateTexts: unlockedBatch.flatMap((line) => [
        line.original,
        ...buildContextLines(sourceLines, line.order, -refinementContextWindow, -1),
        ...buildContextLines(sourceLines, line.order, 1, refinementContextWindow),
        draftLines[line.order]?.literal ?? "",
        draftLines[line.order]?.natural ?? "",
        draftLines[line.order]?.slangAware ?? "",
        draftLines[line.order]?.chosen ?? ""
      ]),
      preferredRenderings
    });
    const correctionExamples = mergeCorrectionExampleSources([
      currentSongCorrectionExamples,
      trackCorrectionExamples.map((example) => ({ ...example, source: "track_memory" as const })),
      artistCorrectionExamples.map((example) => ({ ...example, source: "artist_memory" as const }))
    ]);

    const aiResponse = await requestProviderTranslationRefinement({
      title: options.title,
      artist: options.artist,
      album: options.album,
      sourceLanguage,
      targetLanguage: normalizeLanguage(options.targetLanguage),
      includeTransliteration: options.includeTransliteration,
      includeNotes: options.includeNotes,
      glossaryEntries,
      songContext,
      artistMemory,
      lines: batchDraftLines.map((line) => ({
        index: line.order + 1,
        original: line.original,
        normalizedOriginal: normalizedSourceLookup?.get(line.order)?.canonical ?? line.normalizedOriginal ?? null,
        meaning: line.meaning,
        impliedMeaning: line.impliedMeaning,
        register: line.register,
        literal: line.literal,
        natural: line.natural,
        slangAware: line.slangAware,
        chosen: line.chosen,
        ambiguity: line.ambiguity,
        confidence: line.confidence,
        contextBefore: buildRefinementContext(draftLines, line.order, -refinementContextWindow, -1),
        contextAfter: buildRefinementContext(draftLines, line.order, 1, refinementContextWindow),
        matchingCorrections: buildMatchingCorrectionHints(correctionExamples, [
          line.original,
          ...buildContextLines(sourceLines, line.order, -refinementContextWindow, -1),
          ...buildContextLines(sourceLines, line.order, 1, refinementContextWindow),
          line.literal,
          line.natural,
          line.slangAware,
          line.chosen
        ])
      }))
    });

    model = aiResponse.model || model;
    const unlockedByOrder = new Map(unlockedBatch.map((line) => [line.order, line]));
    let unlockedIndex = 0;

    refinedLines.push(
      ...batch.map((line) => {
        const existingLine = draftLines[line.order];

        if (!unlockedByOrder.has(line.order)) {
          return {
            ...existingLine,
            startMs: line.startMs,
            endMs: line.endMs
          };
        }

        const responseLine = aiResponse.lines[unlockedIndex];
        unlockedIndex += 1;

        return {
          order: line.order,
          original: line.original,
          normalizedOriginal: normalizedSourceLookup?.get(line.order)?.canonical ?? existingLine?.normalizedOriginal ?? null,
          normalizationNotes: normalizedSourceLookup?.get(line.order)?.notes ?? existingLine?.normalizationNotes ?? [],
          meaning: responseLine?.meaning ?? existingLine?.meaning ?? line.original,
          impliedMeaning: responseLine?.impliedMeaning ?? existingLine?.impliedMeaning ?? null,
          register: responseLine?.register ?? existingLine?.register ?? null,
          literal: responseLine?.literal ?? existingLine?.literal ?? "",
          natural: responseLine?.natural ?? existingLine?.natural ?? "",
          slangAware: responseLine?.slangAware ?? existingLine?.slangAware ?? "",
          chosen: responseLine?.chosen ?? responseLine?.translated ?? existingLine?.chosen ?? "",
          translated: responseLine?.chosen ?? responseLine?.translated ?? existingLine?.chosen ?? "",
          transliteration: normalizeGeneratedTransliteration(
            line.original,
            responseLine?.transliteration ?? existingLine?.transliteration ?? null
          ),
          note: responseLine?.note ?? existingLine?.note ?? null,
          ambiguity: responseLine?.ambiguity ?? existingLine?.ambiguity ?? null,
          confidence: responseLine?.confidence ?? existingLine?.confidence ?? "medium",
          selectorReason: responseLine?.selectorReason ?? existingLine?.selectorReason ?? null,
          startMs: line.startMs,
          endMs: line.endMs
        };
      })
    );
  }

  return {
    model,
    lines: alignDraftLinesToSource(sourceLines, applyDuplicateLineReuse(refinedLines), normalizedSourceLookup)
  };
}

async function selectDraftLinesInBatches(
  options: GenerateAiTranslationOptions,
  sourceLines: SourceDraftLine[],
  draftLines: AiDraftLine[],
  sourceLyricsKind: "synced" | "plain",
  sourceLanguage: string,
  songContext: AiSongContext | null,
  artistMemory: Awaited<ReturnType<typeof getAiArtistMemory>>["memory"],
  preferredRenderings: AiGlossaryEntry[],
  artistCorrectionExamples: AiCorrectionExample[],
  trackCorrectionExamples: AiCorrectionExample[],
  lockedOrders?: Set<number>,
  currentSongCorrectionExamples: CorrectionExampleWithSource[] = [],
  normalizedSourceLookup?: Map<number, NormalizedSourceLine>
) {
  const batchSize = getSelectionBatchSize(sourceLyricsKind, sourceLines.length);
  const batches = chunkSourceLines(sourceLines, batchSize);
  const refinementContextWindow = getRefinementContextWindowLines(sourceLines.length);
  const selectedLines: AiDraftLine[] = [];
  let model = "";

  for (const batch of batches) {
    const unlockedBatch = batch.filter(
      (line) => !lockedOrders?.has(line.order) && shouldRunSelectionForLine(draftLines[line.order])
    );

    if (unlockedBatch.length === 0) {
      selectedLines.push(
        ...batch.map((line) => ({
          ...draftLines[line.order],
          startMs: line.startMs,
          endMs: line.endMs
        }))
      );
      continue;
    }

    const glossaryEntries = await loadRelevantGlossaryEntries({
      sourceLanguage,
      artist: options.artist,
      spotifyTrackId: options.spotifyTrackId,
      candidateTexts: unlockedBatch.flatMap((line) => [
        line.original,
        draftLines[line.order]?.literal ?? "",
        draftLines[line.order]?.natural ?? "",
        draftLines[line.order]?.slangAware ?? "",
        draftLines[line.order]?.chosen ?? "",
        ...buildContextLines(sourceLines, line.order, -refinementContextWindow, -1),
        ...buildContextLines(sourceLines, line.order, 1, refinementContextWindow)
      ]),
      preferredRenderings
    });
    const correctionExamples = mergeCorrectionExampleSources([
      currentSongCorrectionExamples,
      trackCorrectionExamples.map((example) => ({ ...example, source: "track_memory" as const })),
      artistCorrectionExamples.map((example) => ({ ...example, source: "artist_memory" as const }))
    ]);

    const aiResponse = await requestProviderTranslationSelection({
      title: options.title,
      artist: options.artist,
      album: options.album,
      sourceLanguage,
      targetLanguage: normalizeLanguage(options.targetLanguage),
      includeTransliteration: options.includeTransliteration,
      includeNotes: options.includeNotes,
      glossaryEntries,
      songContext,
      artistMemory,
      lines: unlockedBatch.map((line) => ({
        index: line.order + 1,
        original: line.original,
        normalizedOriginal: normalizedSourceLookup?.get(line.order)?.canonical ?? draftLines[line.order]?.normalizedOriginal ?? null,
        meaning: draftLines[line.order]?.meaning ?? line.original,
        impliedMeaning: draftLines[line.order]?.impliedMeaning ?? null,
        register: draftLines[line.order]?.register ?? null,
        literal: draftLines[line.order]?.literal ?? "",
        natural: draftLines[line.order]?.natural ?? "",
        slangAware: draftLines[line.order]?.slangAware ?? "",
        currentChosen: draftLines[line.order]?.chosen ?? "",
        note: draftLines[line.order]?.note ?? null,
        ambiguity: draftLines[line.order]?.ambiguity ?? null,
        confidence: draftLines[line.order]?.confidence ?? "medium",
        contextBefore: buildRefinementContext(draftLines, line.order, -refinementContextWindow, -1),
        contextAfter: buildRefinementContext(draftLines, line.order, 1, refinementContextWindow),
        matchingCorrections: buildMatchingCorrectionHints(correctionExamples, [
          line.original,
          draftLines[line.order]?.literal ?? "",
          draftLines[line.order]?.natural ?? "",
          draftLines[line.order]?.slangAware ?? "",
          draftLines[line.order]?.chosen ?? "",
          ...buildContextLines(sourceLines, line.order, -refinementContextWindow, -1),
          ...buildContextLines(sourceLines, line.order, 1, refinementContextWindow)
        ])
      }))
    });

    model = aiResponse.model || model;
    const unlockedByOrder = new Map(unlockedBatch.map((line) => [line.order, line]));
    let unlockedIndex = 0;

    selectedLines.push(
      ...batch.map((line) => {
        if (!unlockedByOrder.has(line.order)) {
          return {
            ...draftLines[line.order],
            startMs: line.startMs,
            endMs: line.endMs
          };
        }

        const responseLine = aiResponse.lines[unlockedIndex];
        unlockedIndex += 1;

        return {
          ...draftLines[line.order],
          chosen: responseLine?.chosen ?? draftLines[line.order]?.chosen ?? "",
          translated: responseLine?.chosen ?? draftLines[line.order]?.chosen ?? "",
          note: responseLine?.note ?? draftLines[line.order]?.note ?? null,
          ambiguity: responseLine?.ambiguity ?? draftLines[line.order]?.ambiguity ?? null,
          confidence: responseLine?.confidence ?? draftLines[line.order]?.confidence ?? "medium",
          selectorReason: responseLine?.selectorReason ?? draftLines[line.order]?.selectorReason ?? null,
          startMs: line.startMs,
          endMs: line.endMs
        };
      })
    );
  }

  return {
    model,
    lines: alignDraftLinesToSource(sourceLines, applyDuplicateLineReuse(selectedLines), normalizedSourceLookup)
  };
}

function shouldPreserveExistingTranslationFile(kind: "missing" | "stub" | "translated" | "malformed", overwrite: boolean) {
  if (kind === "missing" || kind === "stub") {
    return false;
  }

  return !overwrite;
}

function shouldRunSelectionForLine(line: AiDraftLine | undefined) {
  if (!line) {
    return false;
  }

  if (line.confidence !== "high") {
    return true;
  }

  if (line.ambiguity) {
    return true;
  }

  const distinctCandidates = new Set(
    [line.literal, line.natural, line.slangAware, line.chosen].map((value) => value.trim()).filter(Boolean)
  );

  return distinctCandidates.size > 1;
}

export async function rerunDraftAfterManualCorrections(
  draft: AiTranslationDraftFile,
  editedOrders: number[]
) {
  if (editedOrders.length === 0 || draft.lines.length === 0) {
    return draft;
  }

  const sourceLines = buildSourceLinesFromDraft(draft);
  const normalizedSourceLookup = buildNormalizedSourceLineLookup(sourceLines);
  const includeTransliteration = draft.lines.some((line) => line.transliteration !== null);
  const includeNotes = draft.lines.some((line) => line.note !== null);
  const {
    memory: artistMemory,
    preferredRenderings,
    correctionExamples: artistCorrectionExamples
  } = await getAiArtistMemory(draft.artist);
  const trackCorrectionExamples = await getTrackCorrectionExamples(draft.spotifyTrackId).catch(() => []);
  const propagatedDraft = propagateLockedDuplicateLines(draft.lines, new Set(editedOrders));
  const currentSongCorrectionExamples = buildCorrectionExamplesFromDraftLines(
    propagatedDraft.lines,
    propagatedDraft.lockedOrders,
    "current_song"
  );
  const baseOptions: GenerateAiTranslationOptions = {
    spotifyTrackId: draft.spotifyTrackId,
    title: draft.title,
    artist: draft.artist,
    album: draft.album,
    durationMs: draft.durationMs,
    sourceLanguage: draft.sourceLanguage,
    targetLanguage: draft.targetLanguage,
    includeTransliteration,
    includeNotes,
    overwriteExistingTranslation: true
  };
  const skipRefinement = shouldSkipRefinement(draft.mode, sourceLines.length);

  const refinedDraft = skipRefinement
    ? null
    : await refineDraftLinesInBatches(
        baseOptions,
        sourceLines,
        propagatedDraft.lines,
        draft.mode,
        draft.sourceLanguage,
        draft.songContext,
        artistMemory,
        preferredRenderings,
        artistCorrectionExamples,
        trackCorrectionExamples,
        propagatedDraft.lockedOrders,
        currentSongCorrectionExamples,
        normalizedSourceLookup
      ).catch(() => null);

  const selectedDraft = await selectDraftLinesInBatches(
    baseOptions,
    sourceLines,
    refinedDraft?.lines ?? propagatedDraft.lines,
    draft.mode,
    draft.sourceLanguage,
    draft.songContext,
    artistMemory,
    preferredRenderings,
    artistCorrectionExamples,
    trackCorrectionExamples,
    propagatedDraft.lockedOrders,
    currentSongCorrectionExamples,
    normalizedSourceLookup
  ).catch(() => null);

  return {
    ...draft,
    generatedAt: new Date().toISOString(),
    generator: {
      ...draft.generator,
      model: selectedDraft?.model || refinedDraft?.model || draft.generator.model
    },
    artistMemory: artistMemory ?? draft.artistMemory,
    lines: selectedDraft?.lines ?? refinedDraft?.lines ?? propagatedDraft.lines
  } satisfies AiTranslationDraftFile;
}

export function getChosenLineEditOrdersFromDraft(previousDraft: AiTranslationDraftFile, nextDraft: AiTranslationDraftFile) {
  return getChosenLineEditOrders(previousDraft, nextDraft);
}

export function applyManualCorrectionPropagation(
  draft: AiTranslationDraftFile,
  editedOrders: number[]
) {
  if (editedOrders.length === 0 || draft.lines.length === 0) {
    return draft;
  }

  const propagatedDraft = propagateLockedDuplicateLines(draft.lines, new Set(editedOrders));
  const currentSongCorrectionExamples = buildCorrectionExamplesFromDraftLines(
    propagatedDraft.lines,
    propagatedDraft.lockedOrders,
    "current_song"
  );

  const nextLines = propagatedDraft.lines.map((line) => {
    if (propagatedDraft.lockedOrders.has(line.order)) {
      return line;
    }

    const matchingCorrections = buildMatchingCorrectionHints(
      currentSongCorrectionExamples,
      [line.original, line.literal, line.natural, line.slangAware, line.chosen],
      1
    );
    const bestCorrection = matchingCorrections[0];

    if (!bestCorrection || bestCorrection.similarity === "medium") {
      return line;
    }

    const propagatedChosen = bestCorrection.chosen.trim();

    if (!propagatedChosen || propagatedChosen === line.chosen.trim()) {
      return line;
    }

    return {
      ...line,
      chosen: propagatedChosen,
      translated: propagatedChosen,
      note: line.note ?? bestCorrection.note ?? null,
      confidence: bestCorrection.similarity === "exact" ? "high" : line.confidence === "low" ? "medium" : line.confidence,
      selectorReason:
        bestCorrection.similarity === "exact"
          ? "Matched a repeated line you already corrected."
          : "Aligned with a similar line you already corrected."
    } satisfies AiDraftLine;
  });

  return {
    ...draft,
    generatedAt: new Date().toISOString(),
    lines: nextLines
  } satisfies AiTranslationDraftFile;
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
  const normalizedSourceLookup = buildNormalizedSourceLineLookup(sourceLines);

  if (sourceLines.length === 0) {
    return {
      status: "missing_lyrics"
    };
  }

  const targetLanguage = normalizeLanguage(options.targetLanguage);
  const contextResponse = await generateSongContext(options, sourceLines);
  const meaningResponse = await generateMeaningLinesInBatches(
    options,
    sourceLines,
    lyricsCache.kind,
    contextResponse.sourceLanguage,
    contextResponse.songContext,
    contextResponse.artistMemory,
    contextResponse.preferredRenderings,
    contextResponse.artistCorrectionExamples,
    contextResponse.trackCorrectionExamples,
    normalizedSourceLookup
  );
  const skipRefinement = shouldSkipRefinement(lyricsCache.kind, sourceLines.length);
  const initialDraft = await generateDraftLinesInBatches(
    options,
    sourceLines,
    lyricsCache.kind,
    meaningResponse.sourceLanguage,
    contextResponse.songContext,
    contextResponse.artistMemory,
    contextResponse.preferredRenderings,
    contextResponse.artistCorrectionExamples,
    contextResponse.trackCorrectionExamples,
    normalizedSourceLookup,
    meaningResponse.lines
  );
  const refinedDraft = skipRefinement
    ? null
    : await refineDraftLinesInBatches(
        options,
        sourceLines,
        initialDraft.lines,
        lyricsCache.kind,
        initialDraft.sourceLanguage,
        contextResponse.songContext,
        contextResponse.artistMemory,
        contextResponse.preferredRenderings,
        contextResponse.artistCorrectionExamples,
        contextResponse.trackCorrectionExamples,
        undefined,
        [],
        normalizedSourceLookup
      ).catch(() => null);
  const selectedDraft = await selectDraftLinesInBatches(
    options,
    sourceLines,
    refinedDraft?.lines ?? initialDraft.lines,
    lyricsCache.kind,
    initialDraft.sourceLanguage,
    contextResponse.songContext,
    contextResponse.artistMemory,
    contextResponse.preferredRenderings,
    contextResponse.artistCorrectionExamples,
    contextResponse.trackCorrectionExamples,
    undefined,
    [],
    normalizedSourceLookup
  ).catch(() => null);

  const aiResponse = {
    model: selectedDraft?.model || refinedDraft?.model || initialDraft.model,
    sourceLanguage: initialDraft.sourceLanguage,
    lines: selectedDraft?.lines ?? refinedDraft?.lines ?? initialDraft.lines
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
    songContext: contextResponse.songContext,
    artistMemory: contextResponse.artistMemory,
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
