import { getAiArtistMemory } from "@/features/ai/artist-memory";
import { ensureArtistProfile } from "@/features/ai/artist-profile-generator";
import { getTrackCorrectionExamples } from "@/features/ai/correction-memory";
import { getAiGlossaryEntries, getGlossarySearchTerms, type AiGlossaryEntry } from "@/features/ai/glossary";
import { extractAndStoreGlossarySuggestions } from "@/features/ai/glossary-extractor";
import { normalizeArtistKey } from "@/features/ai/glossary-repository";
import {
  getActiveAiProvider,
  getThreeModelPipelineLabel,
  isThreeModelPipelineConfigured,
  requestProviderMeaningAnalysis,
  requestProviderSongContext,
  requestProviderTranslationDraft,
  requestProviderTranslationRefinement,
  requestProviderTranslationSelection,
  type PreviousTranslationRef
} from "@/features/ai/provider";
import { requestAnthropicTranslationDraft } from "@/features/ai/anthropic";
import { requestGeminiDraftComparison } from "@/features/ai/gemini";
import { requestOpenAiTranslationDraft } from "@/features/ai/openai";
import { normalizeLookupText, normalizeRomanizedText, tokenizeNormalizedRomanizedText } from "@/features/ai/romanized-normalization";
import { getAiTranslationDraftByTrackId, writeAiTranslationDraftFile } from "@/features/ai/repository";
import { calcModelCost, recordAiUsageRun } from "@/features/ai/usage-tracker";
import type {
  AiCostSummary,
  AiDraftLine,
  AiCorrectionExample,
  AiCorrectionHint,
  AiSongContext,
  AiTranslationDraftFile,
  GenerateAiTranslationOptions,
  GenerateAiTranslationResult,
  GeneratedTranslationLineDraft,
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

type DraftRequestOptions = {
  title: string;
  artist: string;
  album: string;
  sourceLanguage: string | null;
  targetLanguage: string;
  includeTransliteration: boolean;
  includeNotes: boolean;
  glossaryEntries: AiGlossaryEntry[];
  songContext: AiSongContext | null;
  artistMemory: Awaited<ReturnType<typeof getAiArtistMemory>>["memory"];
  lines: Array<{
    index: number;
    original: string;
    normalizedOriginal?: string | null;
    normalizationNotes?: string[];
    meaning?: string;
    impliedMeaning?: string | null;
    register?: string | null;
    contextBefore?: string[];
    contextAfter?: string[];
    groupIndex?: number;
    groupText?: string;
    matchingCorrections?: AiCorrectionHint[];
  }>;
};

type DraftRequester = (
  options: DraftRequestOptions
) => Promise<{ model: string; sourceLanguage: string; lines: GeneratedTranslationLineDraft[] }>;

async function getHydratedArtistMemory(artist: string | null) {
  await ensureArtistProfile(artist).catch(() => null);
  return getAiArtistMemory(artist);
}

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

// Stop-words for romanized Punjabi/Hindi + common English particles.
// These are excluded when extracting "anchor words" from multi-word terms
// so that short connectives don't pollute the match signal.
const GLOSSARY_STOP_WORDS = new Set([
  "de", "di", "da", "nu", "te", "ton", "ne", "vi", "si", "ke", "kar",
  "aa", "han", "hai", "tha", "ho", "ki", "koi", "jo", "jo", "wala",
  "a", "an", "the", "in", "on", "at", "of", "for", "to", "is", "my",
  "and", "or", "but", "with", "by", "from", "this", "that",
]);

function extractAnchorWords(normalizedTerm: string): string[] {
  return normalizedTerm
    .split(" ")
    .filter((w) => w.length > 2 && !GLOSSARY_STOP_WORDS.has(w));
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

    // For multi-word terms (>2 words), also try anchor-word matching — extract the
    // most distinctive non-stop words and check what fraction appear in the text.
    // This catches cases where romanization varies slightly between the glossary entry
    // and the lyric line (e.g. "neend nahi aundi" vs "neend nhi aundi").
    let anchorMatchBonus = 0;
    if (allTermWords.length > 2) {
      const anchors = extractAnchorWords(normalizedTerms.join(" "));
      if (anchors.length >= 2) {
        const matchedAnchors = anchors.filter((w) => normalizedText.includes(w)).length;
        const ratio = matchedAnchors / anchors.length;
        // ≥60 % anchor match AND at least 2 anchors hit → treat as a strong partial match
        if (ratio >= 0.6 && matchedAnchors >= 2) {
          anchorMatchBonus = Math.round(ratio * 60); // up to +60 pts
        }
      }
    }

    // Also add useCount as a tiebreaker — proven terms rank above untested ones
    const useCountBonus = Math.min(entry.useCount ?? 0, 10) * 2; // up to +20 pts

    const score =
      (hasExactMatch ? 100 : 0) +
      partialMatchCount * 10 +
      anchorMatchBonus +
      useCountBonus +
      getGlossaryCategoryWeight(entry.category) +
      Math.min(allTermWords.length, 4);

    return {
      entry,
      score,
      hasExactMatch: hasExactMatch || anchorMatchBonus > 0
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

async function generateSongContext(
  options: GenerateAiTranslationOptions,
  sourceLines: SourceDraftLine[],
  previousSongContext?: AiSongContext | null
) {
  const requestedSourceLanguage = normalizeRequestedSourceLanguage(options.sourceLanguage);
  const { memory: artistMemory, preferredRenderings, correctionExamples: artistCorrectionExamples } =
    await getHydratedArtistMemory(options.artist);
  const trackCorrectionExamples = await getTrackCorrectionExamples(options.spotifyTrackId).catch(() => []);

  // Reuse previous song context if available — saves an API call and keeps analysis stable
  if (previousSongContext) {
    return {
      artistMemory,
      preferredRenderings,
      artistCorrectionExamples,
      trackCorrectionExamples,
      sourceLanguage: requestedSourceLanguage,
      songContext: previousSongContext
    };
  }

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
  meaningLines: MeaningAnalysisLine[],
  requestDraft: DraftRequester = requestProviderTranslationDraft,
  previousDraftLookup?: Map<number, PreviousTranslationRef>
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

    const aiResponse = await requestDraft({
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
          ]),
          previousTranslation: previousDraftLookup?.get(line.order) ?? null
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
  normalizedSourceLookup?: Map<number, NormalizedSourceLine>,
  previousDraftLookup?: Map<number, PreviousTranslationRef>
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
        ]),
        previousTranslation: previousDraftLookup?.get(line.order) ?? null
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
  normalizedSourceLookup?: Map<number, NormalizedSourceLine>,
  previousDraftLookup?: Map<number, PreviousTranslationRef>
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
        ]),
        previousTranslation: previousDraftLookup?.get(line.order) ?? null
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

function scoreChosenLineSimilarity(reference: string, candidate: string) {
  const normalizedReference = normalizeLineKey(reference);
  const normalizedCandidate = normalizeLineKey(candidate);

  if (!normalizedReference || !normalizedCandidate) {
    return 0;
  }

  if (normalizedReference === normalizedCandidate) {
    return 10_000;
  }

  const referenceTokens = new Set(tokenizeNormalizedLine(reference));
  const candidateTokens = new Set(tokenizeNormalizedLine(candidate));
  const shared = Array.from(referenceTokens).filter((token) => candidateTokens.has(token)).length;
  const union = new Set([...referenceTokens, ...candidateTokens]).size;

  return shared * 100 + (union > 0 ? Math.round((shared / union) * 50) : 0);
}

function chooseDraftBaseLine(
  chosen: string,
  generatorALine: AiDraftLine,
  generatorBLine: AiDraftLine
) {
  if (normalizeLineKey(chosen) === normalizeLineKey(generatorBLine.chosen)) {
    return generatorBLine;
  }

  if (normalizeLineKey(chosen) === normalizeLineKey(generatorALine.chosen)) {
    return generatorALine;
  }

  return scoreChosenLineSimilarity(chosen, generatorBLine.chosen) > scoreChosenLineSimilarity(chosen, generatorALine.chosen)
    ? generatorBLine
    : generatorALine;
}

async function evaluateDraftAlternativesInBatches(
  options: GenerateAiTranslationOptions,
  sourceLines: SourceDraftLine[],
  sourceLyricsKind: "synced" | "plain",
  sourceLanguage: string,
  songContext: AiSongContext | null,
  artistMemory: Awaited<ReturnType<typeof getAiArtistMemory>>["memory"],
  preferredRenderings: AiGlossaryEntry[],
  artistCorrectionExamples: AiCorrectionExample[],
  trackCorrectionExamples: AiCorrectionExample[],
  normalizedSourceLookup: Map<number, NormalizedSourceLine>,
  generatorALines: AiDraftLine[],
  generatorBLines: AiDraftLine[],
  usageSink?: { inputTokens: number; outputTokens: number },
  previousDraftLookup?: Map<number, PreviousTranslationRef>
) {
  const batchSize = getSelectionBatchSize(sourceLyricsKind, sourceLines.length);
  const batches = chunkSourceLines(sourceLines, batchSize);
  const refinementContextWindow = getRefinementContextWindowLines(sourceLines.length);
  const evaluatedLines: AiDraftLine[] = [];
  let model = "";

  for (const batch of batches) {
    const glossaryEntries = await loadRelevantGlossaryEntries({
      sourceLanguage,
      artist: options.artist,
      spotifyTrackId: options.spotifyTrackId,
      candidateTexts: batch.flatMap((line) => [
        line.original,
        generatorALines[line.order]?.chosen ?? "",
        generatorBLines[line.order]?.chosen ?? "",
        generatorALines[line.order]?.literal ?? "",
        generatorBLines[line.order]?.literal ?? "",
        ...buildContextLines(sourceLines, line.order, -refinementContextWindow, -1),
        ...buildContextLines(sourceLines, line.order, 1, refinementContextWindow)
      ]),
      preferredRenderings
    });
    const correctionExamples = mergeCorrectionExampleSources([
      trackCorrectionExamples.map((example) => ({ ...example, source: "track_memory" as const })),
      artistCorrectionExamples.map((example) => ({ ...example, source: "artist_memory" as const }))
    ]);

    const aiResponse = await requestGeminiDraftComparison({
      title: options.title,
      artist: options.artist,
      album: options.album,
      sourceLanguage,
      targetLanguage: normalizeLanguage(options.targetLanguage),
      glossaryEntries,
      songContext,
      artistMemory,
      lines: batch.map((line) => {
        const generatorALine = generatorALines[line.order];
        const generatorBLine = generatorBLines[line.order];

        return {
          index: line.order + 1,
          original: line.original,
          normalizedOriginal: normalizedSourceLookup.get(line.order)?.canonical ?? null,
          meaning: generatorALine?.meaning ?? generatorBLine?.meaning ?? line.original,
          impliedMeaning: generatorALine?.impliedMeaning ?? generatorBLine?.impliedMeaning ?? null,
          register: generatorALine?.register ?? generatorBLine?.register ?? null,
          generatorA: {
            literal: generatorALine?.literal ?? "",
            natural: generatorALine?.natural ?? "",
            slangAware: generatorALine?.slangAware ?? "",
            chosen: generatorALine?.chosen ?? "",
            transliteration: generatorALine?.transliteration ?? null,
            note: generatorALine?.note ?? null,
            ambiguity: generatorALine?.ambiguity ?? null,
            confidence: generatorALine?.confidence ?? "medium"
          },
          generatorB: {
            literal: generatorBLine?.literal ?? "",
            natural: generatorBLine?.natural ?? "",
            slangAware: generatorBLine?.slangAware ?? "",
            chosen: generatorBLine?.chosen ?? "",
            transliteration: generatorBLine?.transliteration ?? null,
            note: generatorBLine?.note ?? null,
            ambiguity: generatorBLine?.ambiguity ?? null,
            confidence: generatorBLine?.confidence ?? "medium"
          },
          contextBefore: buildRefinementContext(generatorALines, line.order, -refinementContextWindow, -1),
          contextAfter: buildRefinementContext(generatorALines, line.order, 1, refinementContextWindow),
          matchingCorrections: buildMatchingCorrectionHints(correctionExamples, [
            line.original,
            generatorALine?.chosen ?? "",
            generatorBLines[line.order]?.chosen ?? "",
            ...buildContextLines(sourceLines, line.order, -refinementContextWindow, -1),
            ...buildContextLines(sourceLines, line.order, 1, refinementContextWindow)
          ]),
          previousTranslation: previousDraftLookup?.get(line.order) ?? null
        };
      })
    }, usageSink);

    model = aiResponse.model || model;

    evaluatedLines.push(
      ...batch.map((line, index) => {
        const generatorALine = generatorALines[line.order];
        const generatorBLine = generatorBLines[line.order];
        const evaluationLine = aiResponse.lines[index];
        const baseLine =
          evaluationLine?.winner === "generator_b"
            ? generatorBLine
            : generatorALine && generatorBLine
              ? chooseDraftBaseLine(evaluationLine?.chosen ?? generatorALine.chosen, generatorALine, generatorBLine)
              : generatorALine ?? generatorBLine;

        if (!baseLine) {
          return generatorALine ?? generatorBLine;
        }

        return {
          ...baseLine,
          chosen: evaluationLine?.chosen ?? baseLine.chosen,
          translated: evaluationLine?.chosen ?? baseLine.chosen,
          note: evaluationLine?.note ?? baseLine.note,
          ambiguity: evaluationLine?.ambiguity ?? baseLine.ambiguity,
          confidence: evaluationLine?.confidence ?? baseLine.confidence,
          selectorReason: evaluationLine?.selectorReason ?? baseLine.selectorReason,
          startMs: line.startMs,
          endMs: line.endMs
        } satisfies AiDraftLine;
      }).filter((line): line is AiDraftLine => Boolean(line))
    );
  }

  return {
    model,
    lines: alignDraftLinesToSource(sourceLines, applyDuplicateLineReuse(evaluatedLines), normalizedSourceLookup)
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
  } = await getHydratedArtistMemory(draft.artist);
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
  const generationStartMs = Date.now();

  // Load previous draft for reference context (non-blocking — generation continues even if this fails)
  const previousDraft = await getAiTranslationDraftByTrackId(options.spotifyTrackId).catch(() => null);
  const previousDraftLookup = buildPreviousDraftLookup(previousDraft);

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
  const contextResponse = await generateSongContext(options, sourceLines, previousDraft?.songContext ?? null);
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
  const useThreeModelPipeline = isThreeModelPipelineConfigured();
  let aiResponse: {
    model: string;
    sourceLanguage: string;
    lines: AiDraftLine[];
  };
  let pipelineCostSummary: AiCostSummary | undefined;

  if (useThreeModelPipeline) {
    const pipelineStartMs = Date.now();
    const usageSinkA = { inputTokens: 0, outputTokens: 0 };
    const usageSinkB = { inputTokens: 0, outputTokens: 0 };
    const usageSinkG = { inputTokens: 0, outputTokens: 0 };
    let genAModel = "";
    let genBModel = "";
    let genADurationMs = 0;
    let genBDurationMs = 0;
    let genGDurationMs = 0;

    const openAiRequester: DraftRequester = async (opts) => {
      const t0 = Date.now();
      const result = await requestOpenAiTranslationDraft(opts, usageSinkA);
      genADurationMs += Date.now() - t0;
      genAModel = result.model;
      return result;
    };

    const anthropicRequester: DraftRequester = async (opts) => {
      const t0 = Date.now();
      const result = await requestAnthropicTranslationDraft(opts, usageSinkB);
      genBDurationMs += Date.now() - t0;
      genBModel = result.model;
      return result;
    };

    const [generatorAInitialDraft, generatorBInitialDraft] = await Promise.all([
      generateDraftLinesInBatches(
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
        meaningResponse.lines,
        openAiRequester,
        previousDraftLookup
      ),
      generateDraftLinesInBatches(
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
        meaningResponse.lines,
        anthropicRequester,
        previousDraftLookup
      )
    ]);

    const geminiT0 = Date.now();
    const evaluatedDraft = await evaluateDraftAlternativesInBatches(
      options,
      sourceLines,
      lyricsCache.kind,
      generatorAInitialDraft.sourceLanguage || generatorBInitialDraft.sourceLanguage || meaningResponse.sourceLanguage,
      contextResponse.songContext,
      contextResponse.artistMemory,
      contextResponse.preferredRenderings,
      contextResponse.artistCorrectionExamples,
      contextResponse.trackCorrectionExamples,
      normalizedSourceLookup,
      generatorAInitialDraft.lines,
      generatorBInitialDraft.lines,
      usageSinkG,
      previousDraftLookup
    );
    genGDurationMs = Date.now() - geminiT0;
    const pipelineDurationMs = Date.now() - pipelineStartMs;

    // Count winner distribution and confidence breakdown from evaluated lines
    const evalLines = evaluatedDraft.lines;
    let winnerA = 0, winnerB = 0, winnerBlend = 0;
    let confHigh = 0, confMed = 0, confLow = 0;
    for (const line of evalLines) {
      if (line.selectorReason != null) {
        // Use confidence to approximate winner - we don't have winner per line in AiDraftLine
        // We track based on chosen vs generatorA chosen
        const aChosen = generatorAInitialDraft.lines[evalLines.indexOf(line)]?.chosen ?? "";
        const bChosen = generatorBInitialDraft.lines[evalLines.indexOf(line)]?.chosen ?? "";
        if (line.chosen === aChosen && line.chosen !== bChosen) winnerA++;
        else if (line.chosen === bChosen && line.chosen !== aChosen) winnerB++;
        else if (line.chosen !== aChosen && line.chosen !== bChosen) winnerBlend++;
        else winnerA++; // fallback
      } else {
        winnerA++;
      }
      if (line.confidence === "high") confHigh++;
      else if (line.confidence === "medium") confMed++;
      else confLow++;
    }

    // Build cost summary for immediate display
    const costA = calcModelCost("openai",    usageSinkA.inputTokens, usageSinkA.outputTokens);
    const costB = calcModelCost("anthropic", usageSinkB.inputTokens, usageSinkB.outputTokens);
    const costG = calcModelCost("gemini",    usageSinkG.inputTokens, usageSinkG.outputTokens);
    pipelineCostSummary = {
      generatorA: { model: genAModel,          inputTokens: usageSinkA.inputTokens, outputTokens: usageSinkA.outputTokens, costUsd: costA },
      generatorB: { model: genBModel,          inputTokens: usageSinkB.inputTokens, outputTokens: usageSinkB.outputTokens, costUsd: costB },
      judge:      { model: evaluatedDraft.model, inputTokens: usageSinkG.inputTokens, outputTokens: usageSinkG.outputTokens, costUsd: costG },
      totalCostUsd: costA + costB + costG,
    };

    // Record the usage run (non-fatal)
    try {
      recordAiUsageRun({
        timestamp: new Date().toISOString(),
        spotifyTrackId: options.spotifyTrackId,
        title: options.title,
        artist: options.artist,
        sourceLanguage: generatorAInitialDraft.sourceLanguage || generatorBInitialDraft.sourceLanguage || meaningResponse.sourceLanguage,
        totalLines: evalLines.length,
        winnerDistribution: { generatorA: winnerA, generatorB: winnerB, blended: winnerBlend },
        confidenceBreakdown: { high: confHigh, medium: confMed, low: confLow },
        generatorA: { model: genAModel, inputTokens: usageSinkA.inputTokens, outputTokens: usageSinkA.outputTokens, durationMs: genADurationMs },
        generatorB: { model: genBModel, inputTokens: usageSinkB.inputTokens, outputTokens: usageSinkB.outputTokens, durationMs: genBDurationMs },
        judge:      { model: evaluatedDraft.model, inputTokens: usageSinkG.inputTokens, outputTokens: usageSinkG.outputTokens, durationMs: genGDurationMs },
        pipelineDurationMs
      });
    } catch {
      // Non-fatal: don't fail the translation if analytics recording fails
    }

    aiResponse = {
      model: `${getThreeModelPipelineLabel()} | Selected:${evaluatedDraft.model}`,
      sourceLanguage: generatorAInitialDraft.sourceLanguage || generatorBInitialDraft.sourceLanguage || meaningResponse.sourceLanguage,
      lines: evaluatedDraft.lines
    };
  } else {
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
      meaningResponse.lines,
      undefined,
      previousDraftLookup
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
          normalizedSourceLookup,
          previousDraftLookup
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
      normalizedSourceLookup,
      previousDraftLookup
    ).catch(() => null);

    aiResponse = {
      model: selectedDraft?.model || refinedDraft?.model || initialDraft.model,
      sourceLanguage: initialDraft.sourceLanguage,
      lines: selectedDraft?.lines ?? refinedDraft?.lines ?? initialDraft.lines
    };
  }

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
      provider: (useThreeModelPipeline ? "multi" : getActiveAiProvider()) as AiTranslationDraftFile["generator"]["provider"],
      model: aiResponse.model
    },
    songContext: contextResponse.songContext,
    artistMemory: contextResponse.artistMemory,
    lines: aiResponse.lines
  };

  const draftFilePath = await writeAiTranslationDraftFile(draftFile);

  if (lyricsCache.kind === "plain") {
    void recordGenerationLog(options.spotifyTrackId, draftFile, pipelineCostSummary, generationStartMs, "draft_only_plain");
    void extractAndStoreGlossarySuggestions({
      spotifyTrackId: options.spotifyTrackId,
      title: options.title,
      artist: options.artist,
      sourceLanguage: draftFile.sourceLanguage,
      lines: draftFile.lines.map((l) => ({ original: l.original, chosen: l.chosen, meaning: l.meaning })),
      existingGlossary: await getAiGlossaryEntries({ language: draftFile.sourceLanguage, artist: options.artist }).catch(() => [])
    });
    return {
      status: "draft_only_plain",
      draftFilePath,
      lineCount: draftFile.lines.length,
      costSummary: pipelineCostSummary
    };
  }

  const translationInspection = await inspectTranslationFile(options.spotifyTrackId);

  if (shouldPreserveExistingTranslationFile(translationInspection.kind, options.overwriteExistingTranslation)) {
    void recordGenerationLog(options.spotifyTrackId, draftFile, pipelineCostSummary, generationStartMs, "draft_only_preserved");
    void extractAndStoreGlossarySuggestions({
      spotifyTrackId: options.spotifyTrackId,
      title: options.title,
      artist: options.artist,
      sourceLanguage: draftFile.sourceLanguage,
      lines: draftFile.lines.map((l) => ({ original: l.original, chosen: l.chosen, meaning: l.meaning })),
      existingGlossary: await getAiGlossaryEntries({ language: draftFile.sourceLanguage, artist: options.artist }).catch(() => [])
    });
    return {
      status: "draft_only_preserved",
      draftFilePath,
      translationFilePath: translationInspection.filePath,
      lineCount: draftFile.lines.length,
      costSummary: pipelineCostSummary
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

  void recordGenerationLog(options.spotifyTrackId, draftFile, pipelineCostSummary, generationStartMs, "saved_translation");
  void extractAndStoreGlossarySuggestions({
    spotifyTrackId: options.spotifyTrackId,
    title: options.title,
    artist: options.artist,
    sourceLanguage: draftFile.sourceLanguage,
    lines: draftFile.lines.map((l) => ({ original: l.original, chosen: l.chosen, meaning: l.meaning })),
    existingGlossary: await getAiGlossaryEntries({ language: draftFile.sourceLanguage, artist: options.artist }).catch(() => [])
  });
  return {
    status: "saved_translation",
    draftFilePath,
    translationFilePath,
    lineCount: draftFile.lines.length,
    costSummary: pipelineCostSummary
  };
}

// ── Previous draft lookup ─────────────────────────────────────────────────

function buildPreviousDraftLookup(
  previousDraft: AiTranslationDraftFile | null | undefined
): Map<number, PreviousTranslationRef> {
  const lookup = new Map<number, PreviousTranslationRef>();
  if (!previousDraft) return lookup;
  for (const line of previousDraft.lines) {
    lookup.set(line.order, {
      chosen: line.chosen,
      confidence: line.confidence,
      manuallyReviewed: line.selectorReason === "Manually reviewed in Lafz."
    });
  }
  return lookup;
}

/**
 * Regenerate specific lines in an existing draft without re-running the full pipeline.
 * Reuses the existing song context, surrounding lines as context, artist memory, and glossary.
 * Runs: meaning analysis → draft generation → selection for the target line only.
 * All orders sharing the same original text are updated together (chorus repetition etc.).
 */
export async function regenerateDraftLines(
  draft: AiTranslationDraftFile,
  primaryOrder: number
): Promise<{ updatedDraft: AiTranslationDraftFile; updatedLines: AiDraftLine[] }> {
  if (draft.lines.length === 0) {
    throw new Error("Draft has no lines to regenerate.");
  }

  const primaryLine = draft.lines.find((l) => l.order === primaryOrder);

  if (!primaryLine) {
    throw new Error(`Line ${primaryOrder} not found in draft.`);
  }

  // Build full source line list from existing draft (preserves timestamps)
  const allSourceLines = buildSourceLinesFromDraft(draft);
  const sortedDraftLines = [...draft.lines].sort((a, b) => a.order - b.order);
  const normalizedSourceLookup = buildNormalizedSourceLineLookup(allSourceLines);

  // Find all orders that share the same original text (handles chorus repetition)
  const primaryKey = normalizeLineKey(primaryLine.original);
  const matchingOrders = primaryKey
    ? draft.lines.filter((l) => normalizeLineKey(l.original) === primaryKey).map((l) => l.order)
    : [primaryOrder];

  // Use the first matching source line as the canonical one for AI requests
  const representativeOrder = matchingOrders[0] ?? primaryOrder;
  const representativeSourceLine = allSourceLines.find((l) => l.order === representativeOrder);

  if (!representativeSourceLine) {
    throw new Error("Could not resolve the source line from the draft.");
  }

  const includeTransliteration = draft.lines.some((l) => l.transliteration !== null);
  const includeNotes = draft.lines.some((l) => l.note !== null);

  // Load artist memory and correction examples
  const {
    memory: artistMemory,
    preferredRenderings,
    correctionExamples: artistCorrectionExamples
  } = await getHydratedArtistMemory(draft.artist);
  const trackCorrectionExamples = await getTrackCorrectionExamples(draft.spotifyTrackId).catch(() => []);

  const correctionExamples = mergeCorrectionExampleSources([
    trackCorrectionExamples.map((e) => ({ ...e, source: "track_memory" as const })),
    artistCorrectionExamples.map((e) => ({ ...e, source: "artist_memory" as const }))
  ]);

  const contextBefore = buildContextLines(allSourceLines, representativeSourceLine.order, -CONTEXT_WINDOW_LINES, -1);
  const contextAfter = buildContextLines(allSourceLines, representativeSourceLine.order, 1, CONTEXT_WINDOW_LINES);
  const candidateTexts = [representativeSourceLine.original, ...contextBefore, ...contextAfter];
  const matchingCorrections = buildMatchingCorrectionHints(correctionExamples, candidateTexts);

  const glossaryEntries = await loadRelevantGlossaryEntries({
    sourceLanguage: draft.sourceLanguage,
    artist: draft.artist,
    spotifyTrackId: draft.spotifyTrackId,
    candidateTexts,
    preferredRenderings
  });

  const normalizedLine = normalizedSourceLookup.get(representativeSourceLine.order);

  // ── Step 1: Meaning analysis ──────────────────────────────────────────────
  const meaningResponse = await requestProviderMeaningAnalysis({
    title: draft.title,
    artist: draft.artist,
    album: draft.album,
    sourceLanguage: draft.sourceLanguage,
    glossaryEntries,
    songContext: draft.songContext,
    artistMemory,
    lines: [
      {
        index: representativeSourceLine.order + 1,
        original: representativeSourceLine.original,
        normalizedOriginal: normalizedLine?.canonical ?? null,
        normalizationNotes: normalizedLine?.notes ?? [],
        contextBefore,
        contextAfter,
        matchingCorrections
      }
    ]
  });

  const meaningLine = meaningResponse.lines[0];

  // ── Step 2: Draft generation ──────────────────────────────────────────────
  const draftResponse = await requestProviderTranslationDraft({
    title: draft.title,
    artist: draft.artist,
    album: draft.album,
    sourceLanguage: draft.sourceLanguage,
    targetLanguage: draft.targetLanguage,
    includeTransliteration,
    includeNotes,
    glossaryEntries,
    songContext: draft.songContext,
    artistMemory,
    lines: [
      {
        index: representativeSourceLine.order + 1,
        original: representativeSourceLine.original,
        normalizedOriginal: normalizedLine?.canonical ?? null,
        normalizationNotes: normalizedLine?.notes ?? [],
        meaning: meaningLine?.meaning ?? primaryLine.meaning,
        impliedMeaning: meaningLine?.impliedMeaning ?? primaryLine.impliedMeaning,
        register: meaningLine?.register ?? primaryLine.register,
        contextBefore,
        contextAfter,
        matchingCorrections
      }
    ]
  });

  const generatedLine = draftResponse.lines[0];

  if (!generatedLine) {
    throw new Error("AI returned no output for the line regeneration.");
  }

  // Build the initial regenerated line
  let newLine: AiDraftLine = {
    order: representativeSourceLine.order,
    original: representativeSourceLine.original,
    normalizedOriginal: normalizedLine?.canonical ?? primaryLine.normalizedOriginal,
    normalizationNotes: normalizedLine?.notes ?? primaryLine.normalizationNotes,
    meaning: meaningLine?.meaning ?? primaryLine.meaning,
    impliedMeaning: meaningLine?.impliedMeaning ?? primaryLine.impliedMeaning,
    register: meaningLine?.register ?? primaryLine.register,
    literal: generatedLine.literal,
    natural: generatedLine.natural,
    slangAware: generatedLine.slangAware,
    chosen: generatedLine.chosen,
    translated: generatedLine.chosen,
    transliteration: normalizeGeneratedTransliteration(representativeSourceLine.original, generatedLine.transliteration ?? null),
    note: generatedLine.note ?? null,
    ambiguity: generatedLine.ambiguity ?? null,
    confidence: generatedLine.confidence,
    selectorReason: generatedLine.selectorReason ?? null,
    startMs: representativeSourceLine.startMs,
    endMs: representativeSourceLine.endMs
  };

  // ── Step 3: Selection (if needed) ────────────────────────────────────────
  if (shouldRunSelectionForLine(newLine)) {
    const selectionResponse = await requestProviderTranslationSelection({
      title: draft.title,
      artist: draft.artist,
      album: draft.album,
      sourceLanguage: draft.sourceLanguage,
      targetLanguage: draft.targetLanguage,
      includeTransliteration,
      includeNotes,
      glossaryEntries,
      songContext: draft.songContext,
      artistMemory,
      lines: [
        {
          index: newLine.order + 1,
          original: newLine.original,
          normalizedOriginal: normalizedLine?.canonical ?? newLine.normalizedOriginal ?? null,
          meaning: newLine.meaning,
          impliedMeaning: newLine.impliedMeaning,
          register: newLine.register,
          literal: newLine.literal,
          natural: newLine.natural,
          slangAware: newLine.slangAware,
          currentChosen: newLine.chosen,
          note: newLine.note,
          ambiguity: newLine.ambiguity,
          confidence: newLine.confidence,
          contextBefore: buildRefinementContext(sortedDraftLines, newLine.order, -CONTEXT_WINDOW_LINES, -1),
          contextAfter: buildRefinementContext(sortedDraftLines, newLine.order, 1, CONTEXT_WINDOW_LINES),
          matchingCorrections: buildMatchingCorrectionHints(correctionExamples, [
            newLine.original,
            newLine.literal,
            newLine.natural,
            newLine.slangAware,
            newLine.chosen
          ])
        }
      ]
    }).catch(() => null);

    const selLine = selectionResponse?.lines[0];

    if (selLine) {
      newLine = {
        ...newLine,
        chosen: selLine.chosen ?? newLine.chosen,
        translated: selLine.chosen ?? newLine.chosen,
        ambiguity: selLine.ambiguity ?? newLine.ambiguity,
        note: selLine.note ?? newLine.note,
        confidence: selLine.confidence ?? newLine.confidence,
        selectorReason: selLine.selectorReason ?? newLine.selectorReason
      };
    }
  }

  // Apply the result to all matching orders (the target line and its repeated occurrences)
  const updatedLines: AiDraftLine[] = [];

  const updatedDraftLines = draft.lines.map((line) => {
    if (!matchingOrders.includes(line.order)) {
      return line;
    }

    const result: AiDraftLine = {
      ...newLine,
      order: line.order,
      startMs: line.startMs,
      endMs: line.endMs
    };

    updatedLines.push(result);
    return result;
  });

  const updatedDraft: AiTranslationDraftFile = {
    ...draft,
    generatedAt: new Date().toISOString(),
    lines: updatedDraftLines
  };

  return { updatedDraft, updatedLines };
}

// ── Generation log helper ─────────────────────────────────────────────────

async function recordGenerationLog(
  spotifyTrackId: string,
  draftFile: AiTranslationDraftFile,
  costSummary: import("@/features/ai/types").AiCostSummary | undefined,
  startMs: number,
  resultStatus: string
): Promise<void> {
  try {
    const { appendGenerationLogEntry } = await import("@/features/ai/generation-log");
    const now = Date.now();
    const lines = draftFile.lines;
    await appendGenerationLogEntry(spotifyTrackId, {
      id: `${spotifyTrackId}-${now}`,
      timestampMs: now,
      startedAt: new Date(startMs).toISOString(),
      durationMs: now - startMs,
      model: draftFile.generator.model,
      provider: draftFile.generator.provider,
      lineCount: lines.length,
      lowCount: lines.filter((l) => l.confidence === "low").length,
      mediumCount: lines.filter((l) => l.confidence === "medium").length,
      highCount: lines.filter((l) => l.confidence === "high").length,
      sourceLanguage: draftFile.sourceLanguage,
      targetLanguage: draftFile.targetLanguage,
      resultStatus,
      costSummary: costSummary ?? null,
    });
  } catch {
    // Non-fatal
  }
}
