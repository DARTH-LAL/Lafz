import { getAiArtistMemory } from "@/features/ai/artist-memory";
import { ensureArtistProfile } from "@/features/ai/artist-profile-generator";
import { getTrackCorrectionExamples } from "@/features/ai/correction-memory";
import { getAiGlossaryEntries, getGlossarySearchTerms, type AiGlossaryEntry } from "@/features/ai/glossary";
import { extractAndStoreGlossarySuggestions } from "@/features/ai/glossary-extractor";
import { normalizeArtistKey } from "@/features/ai/glossary-repository";
import { isAiConfigured } from "@/features/ai/provider";
import { buildSongTranslationMemoryPack, mergeBrainMemoryIntoArtistContext } from "@/features/brain/memory-pack";
import { syncDraftIntoLafzBrain } from "@/features/brain/sync";
import { requestGeminiDraftComparison, requestGeminiTranslationDraft } from "@/features/ai/gemini";
import {
  requestOpenAiMeaningAnalysis,
  requestOpenAiTranslationDraft,
  requestOpenAiSongContext,
  requestOpenAiSurfacePolish,
  requestOpenAiSurfacePolishAudit,
  requestOpenAiWorldModel
} from "@/features/ai/openai";
import { requestAnthropicTranslationDraft } from "@/features/ai/anthropic";
import { evaluateSurfacePolishCandidate } from "@/features/ai/surface-polish";
import { normalizeLookupText, normalizeRomanizedText, tokenizeNormalizedRomanizedText } from "@/features/ai/romanized-normalization";
import { buildTrackTranslationFromAiDraft, getAiTranslationDraftByTrackId, writeAiTranslationDraftFile } from "@/features/ai/repository";
import { calcModelCost, recordAiUsageRun } from "@/features/ai/usage-tracker";
import { buildWorldModelLineLookup, deriveVerseStatesFromWorldModel } from "@/features/ai/world-model";
import type {
  AiCostSummary,
  AiDraftLine,
  AiCorrectionExample,
  AiCorrectionHint,
  AiWorldModel,
  AiWorldModelLine,
  PreviousTranslationRef,
  AiSongContext,
  AiTranslationDraftFile,
  AiVerseState,
  GenerateAiTranslationOptions,
  GenerateAiTranslationResult,
  GeneratedTranslationLineDraft,
  MeaningAnalysisLine
} from "@/features/ai/types";
import { getLyricsCacheByTrackId } from "@/features/lyrics/repository";
import type { LyricsCacheFile } from "@/features/lyrics/types";
import { inspectTranslationFile } from "@/features/translations/inspection";
import { getTranslationByTrackId, writeTrackTranslationFile } from "@/features/translations/repository";
import type { TrackTranslation } from "@/features/translations/types";

const CONTEXT_WINDOW_LINES = 2;
const REFINEMENT_CONTEXT_WINDOW_LINES = 2;
const SONG_CONTEXT_MAX_LINES = 24;
const MAX_GROUP_LINES = 4;
const SYNCED_GROUP_BREAK_GAP_MS = 12_000;
const LARGE_TRACK_LINE_COUNT = 56;
const VERY_LARGE_TRACK_LINE_COUNT = 84;
const SURFACE_POLISH_BATCH_SIZE = 10;
const GENERATOR_B_RETRY_DELAY_MS = 1500;

function getInitialBatchSize(sourceLyricsKind: "synced" | "plain", totalLineCount: number) {
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

function getComparisonBatchSize(sourceLyricsKind: "synced" | "plain", totalLineCount: number) {
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

function getDraftContextWindowLines(totalLineCount: number) {
  return totalLineCount >= LARGE_TRACK_LINE_COUNT ? 1 : CONTEXT_WINDOW_LINES;
}

function getComparisonContextWindowLines(totalLineCount: number) {
  return totalLineCount >= LARGE_TRACK_LINE_COUNT ? 1 : REFINEMENT_CONTEXT_WINDOW_LINES;
}

function shouldIncludeGroupText(sourceLyricsKind: "synced" | "plain", totalLineCount: number) {
  return sourceLyricsKind === "plain" || totalLineCount < LARGE_TRACK_LINE_COUNT;
}

function isTransientGeminiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /high demand|temporarily unavailable|please try again later|rate limit|429|timeout|timed out|fetch failed|econnreset|econnrefused|aborted/i.test(message);
}

async function retryGeminiGeneratorB<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (!isTransientGeminiError(error)) {
      throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, GENERATOR_B_RETRY_DELAY_MS));
    return action();
  }
}

async function requestGeneratorBTranslationDraftWithFallback(
  options: Parameters<typeof requestOpenAiTranslationDraft>[0],
  usageSink: { inputTokens: number; outputTokens: number }
) {
  try {
    return await retryGeminiGeneratorB(() =>
      requestGeminiTranslationDraft({ ...options, draftVariant: "generator_b" }, usageSink)
    );
  } catch (error) {
    if (!isTransientGeminiError(error)) {
      throw error;
    }

    console.warn("[lafz] Gemini generator B is unavailable; falling back to OpenAI for this draft.");
    const fallback = await requestOpenAiTranslationDraft(options, usageSink);

    return {
      model: fallback.model,
      sourceLanguage: fallback.sourceLanguage,
      lines: fallback.lines
    };
  }
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
  worldModel: AiWorldModel | null;
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
    verseState?: AiVerseState | null;
    lineWorldModel?: AiWorldModelLine | null;
    matchingCorrections?: AiCorrectionHint[];
    previousTranslation?: PreviousTranslationRef | null;
  }>;
};

type DraftRequester = (
  options: DraftRequestOptions
) => Promise<{ model: string; sourceLanguage: string; lines: GeneratedTranslationLineDraft[] }>;

async function getHydratedArtistMemory(artist: string | null) {
  void ensureArtistProfile(artist).catch(() => null);
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

const VERSE_INTENT_KEYWORDS: Array<{ intent: string; keywords: string[] }> = [
  { intent: "loyalty", keywords: ["friend", "friendship", "crew", "boys", "solid", "loyal", "share", "brother"] },
  { intent: "flex", keywords: ["name", "bells", "fame", "status", "jeep", "horse", "ride", "money", "brand"] },
  { intent: "warning", keywords: ["opp", "enemy", "rival", "double", "lion", "prey", "step", "beneath", "dangerous"] },
  { intent: "romance", keywords: ["girl", "she", "her", "love", "eyes", "looks", "heart", "beauty"] },
  { intent: "pride", keywords: ["pride", "honor", "dignity", "self respect", "guts", "courage"] },
  { intent: "scarcity", keywords: ["little money", "less money", "money is low", "few", "short on money"] },
  { intent: "territory", keywords: ["farm", "home", "property", "land", "territory"] }
];

function tokenizeEnglishHint(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function buildVerseStateSummary(parts: {
  topIntents: string[];
  stance: string | null;
  target: string | null;
  songTone: string | null;
}) {
  const segments: string[] = [];

  if (parts.topIntents.length > 0) {
    segments.push(parts.topIntents.join(" + "));
  }

  if (parts.stance) {
    segments.push(parts.stance);
  }

  if (parts.target) {
    segments.push(`aimed at ${parts.target}`);
  }

  if (parts.songTone) {
    segments.push(`tone: ${parts.songTone}`);
  }

  return segments.join(", ");
}

function inferVerseStates(
  sourceGroups: SourceLineGroup[],
  sourceLines: SourceDraftLine[],
  meaningLines: MeaningAnalysisLine[],
  songContext: AiSongContext | null
) {
  return sourceGroups.map((group) => {
    const textBank = group.lineOrders.flatMap((order) => {
      const source = sourceLines[order];
      const meaning = meaningLines[order];
      return [source?.original ?? "", meaning?.meaning ?? "", meaning?.impliedMeaning ?? "", meaning?.register ?? ""];
    });
    const lowered = textBank.join(" ").toLowerCase();
    const intentScores = new Map<string, number>();

    for (const { intent, keywords } of VERSE_INTENT_KEYWORDS) {
      let score = 0;
      for (const keyword of keywords) {
        if (lowered.includes(keyword)) {
          score += keyword.includes(" ") ? 2 : 1;
        }
      }
      if (score > 0) {
        intentScores.set(intent, score);
      }
    }

    const topIntents = [...intentScores.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([intent]) => intent);

    const target =
      topIntents.includes("romance")
        ? "romantic interest"
        : topIntents.includes("warning")
          ? "rivals"
          : topIntents.includes("loyalty")
            ? "crew"
            : songContext?.addressee ?? null;

    const stance =
      topIntents.includes("warning")
        ? "dominant warning"
        : topIntents.includes("flex")
          ? "status flex"
          : topIntents.includes("loyalty")
            ? "crew loyalty"
            : topIntents.includes("romance")
              ? "confident flirtation"
              : topIntents.includes("pride")
                ? "self-respect"
                : songContext?.stance ?? null;

    const tension =
      topIntents.includes("warning")
        ? "high"
        : topIntents.includes("flex") || topIntents.includes("romance")
          ? "medium"
          : null;

    const caution =
      topIntents.includes("scarcity")
        ? "Watch for money/pride lines being flattened into generic fame flex."
        : topIntents.includes("territory")
          ? "Watch for concrete farm/property imagery being over-smoothed."
          : null;

    return {
      groupIndex: group.index,
      startOrder: group.lineOrders[0] ?? 0,
      endOrder: group.lineOrders[group.lineOrders.length - 1] ?? 0,
      summary: buildVerseStateSummary({
        topIntents,
        stance,
        target,
        songTone: songContext?.tone ?? null
      }),
      stance,
      target,
      dominantIntents: topIntents,
      tension,
      caution
    } satisfies AiVerseState;
  });
}

function buildVerseStateLookup(verseStates: AiVerseState[] | undefined) {
  const lookup = new Map<number, AiVerseState>();

  for (const state of verseStates ?? []) {
    for (let order = state.startOrder; order <= state.endOrder; order += 1) {
      lookup.set(order, state);
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

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function getAiPipelineErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isTimeoutLikeAiError(error: unknown) {
  return /timeout|timed out|aborted/i.test(getAiPipelineErrorMessage(error));
}

function isRetryableAiProviderError(error: unknown) {
  return /timeout|timed out|aborted|fetch failed|connect|connection|socket|econnrefused|etimedout|network/i.test(
    getAiPipelineErrorMessage(error)
  );
}

function annotateProviderStageError(provider: string, stage: string, error: unknown) {
  const originalMessage = getAiPipelineErrorMessage(error);

  if (originalMessage.toLowerCase().includes(provider.toLowerCase()) && originalMessage.toLowerCase().includes(stage.toLowerCase())) {
    return error instanceof Error ? error : new Error(originalMessage);
  }

  const prefix = isTimeoutLikeAiError(error)
    ? `${provider} ${stage} timed out while Lafz was waiting for the provider response.`
    : `${provider} ${stage} failed.`;

  return new Error(`${prefix} ${originalMessage}`);
}

async function withProviderStageRetry<T>(options: {
  provider: string;
  stage: string;
  action: () => Promise<T>;
  retries?: number;
}) {
  const retries = options.retries ?? 1;
  let attempt = 0;

  while (true) {
    try {
      return await options.action();
    } catch (error) {
      if (!isRetryableAiProviderError(error) || attempt >= retries) {
        throw annotateProviderStageError(options.provider, options.stage, error);
      }

      attempt += 1;
      console.warn(`[lafz] Retrying ${options.provider} ${options.stage} after recoverable provider error (attempt ${attempt + 1}).`);
    }
  }
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

/**
 * Returns the terms from an artist glossary that genuinely match the given lyric
 * texts (exact, anchor-word, or strong partial). Used for per-run hit tracking —
 * does NOT include fallback entries injected for coverage.
 */
export function computeGlossaryHits(
  glossaryEntries: AiGlossaryEntry[],
  lyricTexts: string[]
): string[] {
  if (glossaryEntries.length === 0 || lyricTexts.length === 0) return [];
  const normalizedText = lyricTexts.map(normalizeLineKey).join(" ");

  return glossaryEntries
    .filter((entry) => {
      const normalizedTerms = getGlossarySearchTerms(entry);
      const allTermWords = normalizedTerms.flatMap((t) => t.split(" ").filter(Boolean));

      if (normalizedTerms.some((t) => t.length > 0 && normalizedText.includes(t))) return true;

      if (allTermWords.length > 2) {
        const anchors = extractAnchorWords(normalizedTerms.join(" "));
        if (anchors.length >= 2) {
          const matched = anchors.filter((w) => normalizedText.includes(w)).length;
          if (matched / anchors.length >= 0.6 && matched >= 2) return true;
        }
      }
      return false;
    })
    .map((e) => e.term);
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
      chosen: draftLine?.chosen ?? "",
      transliteration: normalizeGeneratedTransliteration(sourceLine.original, draftLine?.transliteration ?? null),
      note: draftLine?.note ?? null,
      ambiguity: draftLine?.ambiguity ?? null,
      confidence: draftLine?.confidence ?? "medium",
      selectorReason: draftLine?.selectorReason ?? null,
      selectionWinner: draftLine?.selectionWinner ?? null,
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
      transliteration: firstSeen.transliteration,
      note: firstSeen.note,
      ambiguity: firstSeen.ambiguity,
      confidence: firstSeen.confidence,
      selectorReason: firstSeen.selectorReason,
      selectionWinner: firstSeen.selectionWinner ?? null
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
      transliteration: lockedLine.transliteration,
      note: lockedLine.note,
      ambiguity: lockedLine.ambiguity,
      confidence: lockedLine.confidence,
      selectorReason: "Matched a repeated line you already corrected.",
      selectionWinner: lockedLine.selectionWinner ?? null
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

async function requestMeaningBatchWithRecovery(options: {
  provider: string;
  stage: string;
  batch: SourceDraftLine[];
  requestBatch: (batch: SourceDraftLine[]) => Promise<{ model: string; sourceLanguage: string; lines: MeaningAnalysisLine[] }>;
  retryAttempt?: number;
}): Promise<{ model: string; sourceLanguage: string; lines: MeaningAnalysisLine[] }> {
  try {
    return await options.requestBatch(options.batch);
  } catch (error) {
    if (!isRetryableAiProviderError(error)) {
      throw annotateProviderStageError(options.provider, options.stage, error);
    }

    const retryAttempt = options.retryAttempt ?? 0;

    if (retryAttempt < 1) {
      console.warn(`[lafz] Retrying ${options.provider} ${options.stage} batch after recoverable provider error.`);
      return requestMeaningBatchWithRecovery({
        ...options,
        retryAttempt: retryAttempt + 1
      });
    }

    if (options.batch.length > 1) {
      const midpoint = Math.ceil(options.batch.length / 2);
      console.warn(
        `[lafz] ${options.provider} ${options.stage} still slow after retry; splitting ${options.batch.length} lines into ${midpoint} and ${
          options.batch.length - midpoint
        }.`
      );

      const left = await requestMeaningBatchWithRecovery({
        ...options,
        batch: options.batch.slice(0, midpoint),
        retryAttempt: 0
      });
      const right = await requestMeaningBatchWithRecovery({
        ...options,
        batch: options.batch.slice(midpoint),
        retryAttempt: 0
      });

      return {
        model: left.model || right.model,
        sourceLanguage: left.sourceLanguage || right.sourceLanguage,
        lines: [...left.lines, ...right.lines]
      };
    }

    throw annotateProviderStageError(options.provider, options.stage, error);
  }
}

async function requestDraftBatchWithRecovery(options: {
  provider: string;
  stage: string;
  batch: SourceDraftLine[];
  requestBatch: (batch: SourceDraftLine[]) => Promise<{ model: string; sourceLanguage: string; lines: GeneratedTranslationLineDraft[] }>;
  retryAttempt?: number;
}): Promise<{ model: string; sourceLanguage: string; lines: GeneratedTranslationLineDraft[] }> {
  try {
    return await options.requestBatch(options.batch);
  } catch (error) {
    if (!isRetryableAiProviderError(error)) {
      throw annotateProviderStageError(options.provider, options.stage, error);
    }

    const retryAttempt = options.retryAttempt ?? 0;

    if (retryAttempt < 1) {
      console.warn(`[lafz] Retrying ${options.provider} ${options.stage} batch after recoverable provider error.`);
      return requestDraftBatchWithRecovery({
        ...options,
        retryAttempt: retryAttempt + 1
      });
    }

    if (options.batch.length > 1) {
      const midpoint = Math.ceil(options.batch.length / 2);
      console.warn(
        `[lafz] ${options.provider} ${options.stage} still slow after retry; splitting ${options.batch.length} lines into ${midpoint} and ${
          options.batch.length - midpoint
        }.`
      );

      const left = await requestDraftBatchWithRecovery({
        ...options,
        batch: options.batch.slice(0, midpoint),
        retryAttempt: 0
      });
      const right = await requestDraftBatchWithRecovery({
        ...options,
        batch: options.batch.slice(midpoint),
        retryAttempt: 0
      });

      return {
        model: left.model || right.model,
        sourceLanguage: left.sourceLanguage || right.sourceLanguage,
        lines: [...left.lines, ...right.lines]
      };
    }

    throw annotateProviderStageError(options.provider, options.stage, error);
  }
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
  const { memory: loadedArtistMemory, preferredRenderings: loadedPreferredRenderings, correctionExamples: artistCorrectionExamples } =
    await getHydratedArtistMemory(options.artist);
  const trackCorrectionExamples = await getTrackCorrectionExamples(options.spotifyTrackId).catch(() => []);
  const brainPack = await buildSongTranslationMemoryPack({
    spotifyTrackId: options.spotifyTrackId,
    artist: options.artist,
    candidateTexts: sourceLines.slice(0, SONG_CONTEXT_MAX_LINES).map((line) => line.original)
  }).catch(() => null);
  const { artistMemory, preferredRenderings } = mergeBrainMemoryIntoArtistContext({
    artist: options.artist,
    artistMemory: loadedArtistMemory,
    preferredRenderings: loadedPreferredRenderings,
    pack: brainPack
  });

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

  const response = await withProviderStageRetry({
    provider: "OpenAI",
    stage: "song context",
    retries: 1,
    action: () =>
      requestOpenAiSongContext({
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
      })
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

  const glossaryEntries = await loadRelevantGlossaryEntries({
    sourceLanguage: inferredSourceLanguage,
    artist: options.artist,
    spotifyTrackId: options.spotifyTrackId,
    candidateTexts: sourceLines.flatMap((line) => {
      const group = groupLookup.get(line.order);
      const normalizedLine = normalizedSourceLookup.get(line.order);
      return [
        line.original,
        normalizedLine?.canonical ?? "",
        includeGroupText ? group?.text ?? "" : ""
      ];
    }),
    preferredRenderings
  });

  for (const batch of batches) {
    const aiResponse = await requestMeaningBatchWithRecovery({
      provider: "OpenAI",
      stage: "meaning analysis",
      batch,
      requestBatch: (currentBatch) =>
        requestOpenAiMeaningAnalysis({
          title: options.title,
          artist: options.artist,
          album: options.album,
          sourceLanguage: inferredSourceLanguage,
          glossaryEntries,
          songContext,
          artistMemory,
          lines: currentBatch.map((line) => {
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
              groupText: includeGroupText ? group?.text : undefined
            };
          })
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

async function generateWorldModel(
  options: GenerateAiTranslationOptions,
  sourceLines: SourceDraftLine[],
  requestedSourceLanguage: string | null,
  songContext: AiSongContext | null,
  artistMemory: Awaited<ReturnType<typeof getAiArtistMemory>>["memory"],
  preferredRenderings: AiGlossaryEntry[],
  normalizedSourceLookup: Map<number, NormalizedSourceLine>,
  sourceGroups: SourceLineGroup[],
  meaningLines: MeaningAnalysisLine[]
) {
  const groupLookup = buildLineGroupLookup(sourceGroups);
  const glossaryEntries = await loadRelevantGlossaryEntries({
    sourceLanguage: requestedSourceLanguage,
    artist: options.artist,
    spotifyTrackId: options.spotifyTrackId,
    candidateTexts: sourceLines.flatMap((line) => {
      const group = groupLookup.get(line.order);
      const normalizedLine = normalizedSourceLookup.get(line.order);
      const meaningLine = meaningLines[line.order];

      return [
        line.original,
        normalizedLine?.canonical ?? "",
        meaningLine?.meaning ?? "",
        meaningLine?.impliedMeaning ?? "",
        group?.text ?? ""
      ];
    }),
    preferredRenderings
  });

  const response = await withProviderStageRetry({
    provider: "OpenAI",
    stage: "world model",
    retries: 1,
    action: () =>
      requestOpenAiWorldModel({
        title: options.title,
        artist: options.artist,
        album: options.album,
        sourceLanguage: requestedSourceLanguage,
        songContext,
        glossaryEntries,
        artistMemory,
        verses: sourceGroups.map((group) => ({
          groupIndex: group.index,
          startOrder: group.lineOrders[0] ?? 0,
          endOrder: group.lineOrders[group.lineOrders.length - 1] ?? 0,
          text: group.text
        })),
        lines: sourceLines.map((line) => {
          const group = groupLookup.get(line.order);
          const normalizedLine = normalizedSourceLookup.get(line.order);
          const meaningLine = meaningLines[line.order];

          return {
            index: line.order + 1,
            original: line.original,
            normalizedOriginal: normalizedLine?.canonical ?? null,
            meaning: meaningLine?.meaning ?? line.original,
            impliedMeaning: meaningLine?.impliedMeaning ?? null,
            register: meaningLine?.register ?? null,
            groupIndex: group?.index ?? null,
            groupText: group?.text ?? null
          };
        })
      })
  });

  return {
    model: response.model,
    sourceLanguage: normalizeLanguage(response.sourceLanguage || requestedSourceLanguage || "Unknown"),
    worldModel: response.worldModel
  };
}

async function generateDraftLinesInBatches(
  options: GenerateAiTranslationOptions,
  sourceLines: SourceDraftLine[],
  sourceLyricsKind: "synced" | "plain",
  requestedSourceLanguage: string | null,
  songContext: AiSongContext | null,
  worldModel: AiWorldModel | null,
  artistMemory: Awaited<ReturnType<typeof getAiArtistMemory>>["memory"],
  preferredRenderings: AiGlossaryEntry[],
  artistCorrectionExamples: AiCorrectionExample[],
  trackCorrectionExamples: AiCorrectionExample[],
  normalizedSourceLookup: Map<number, NormalizedSourceLine>,
  verseStateLookup: Map<number, AiVerseState>,
  worldModelLineLookup: Map<number, AiWorldModelLine>,
  meaningLines: MeaningAnalysisLine[],
  providerLabel: "OpenAI" | "Anthropic" | "Gemini",
  generatorLabel: "generator A" | "generator B",
  requestDraft: DraftRequester,
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

  const glossaryEntries = await loadRelevantGlossaryEntries({
    sourceLanguage: inferredSourceLanguage,
    artist: options.artist,
    spotifyTrackId: options.spotifyTrackId,
    candidateTexts: sourceLines.flatMap((line) => {
      const group = groupLookup.get(line.order);
      return [
        line.original,
        includeGroupText ? group?.text ?? "" : ""
      ];
    }),
    preferredRenderings
  });
  const correctionExamples = mergeCorrectionExampleSources([
    trackCorrectionExamples.map((example) => ({ ...example, source: "track_memory" as const })),
    artistCorrectionExamples.map((example) => ({ ...example, source: "artist_memory" as const }))
  ]);

  for (const batch of batches) {
    const aiResponse = await requestDraftBatchWithRecovery({
      provider: providerLabel,
      stage: `${generatorLabel} draft generation`,
      batch,
      requestBatch: (currentBatch) =>
        requestDraft({
          title: options.title,
          artist: options.artist,
          album: options.album,
          sourceLanguage: inferredSourceLanguage,
          targetLanguage: normalizeLanguage(options.targetLanguage),
          includeTransliteration: options.includeTransliteration,
          includeNotes: options.includeNotes,
          glossaryEntries,
          songContext,
          worldModel,
          artistMemory,
          lines: currentBatch.map((line) => {
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
              verseState: verseStateLookup.get(line.order) ?? null,
              lineWorldModel: worldModelLineLookup.get(line.order) ?? null,
              matchingCorrections: buildMatchingCorrectionHints(correctionExamples, [
                line.original,
                ...buildContextLines(sourceLines, line.order, -contextWindowLines, -1),
                ...buildContextLines(sourceLines, line.order, 1, contextWindowLines),
                includeGroupText ? group?.text ?? "" : ""
              ]),
              previousTranslation: previousDraftLookup?.get(line.order) ?? null
            };
          })
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
        meaning: meaningLines[line.order]?.meaning ?? line.original,
        impliedMeaning: meaningLines[line.order]?.impliedMeaning ?? null,
        register: meaningLines[line.order]?.register ?? null,
        literal: aiResponse.lines[index]?.literal ?? "",
        natural: aiResponse.lines[index]?.natural ?? "",
        slangAware:
          aiResponse.lines[index]?.slangAware ??
          aiResponse.lines[index]?.natural ??
          "",
        chosen: aiResponse.lines[index]?.chosen ?? "",
        transliteration: normalizeGeneratedTransliteration(line.original, aiResponse.lines[index]?.transliteration ?? null),
        note: aiResponse.lines[index]?.note ?? null,
        ambiguity: aiResponse.lines[index]?.ambiguity ?? null,
        confidence: aiResponse.lines[index]?.confidence ?? "medium",
        selectorReason: aiResponse.lines[index]?.selectorReason ?? null,
        selectionWinner: null,
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

const ADLIB_KEYS = new Set(["uh huh", "uh", "yeah", "woo", "whoa", "nah", "huh", "oh", "hey", "aujla", "mxrci"]);

function normalizeEnglishChoiceKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isMeaningfulSourceLine(value: string) {
  const trimmed = value.trim();
  if (trimmed.length >= 10) {
    return true;
  }

  return tokenizeEnglishHint(trimmed).length >= 3;
}

function isAdlibLikeText(value: string) {
  const normalized = normalizeEnglishChoiceKey(value);
  if (!normalized) {
    return false;
  }

  if (ADLIB_KEYS.has(normalized)) {
    return true;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  return tokens.length <= 2 && tokens.every((token) => ADLIB_KEYS.has(token) || token.length <= 3);
}

function appendSurfacePolishReason(baseReason: string | null, polishReason: string | null) {
  const normalizedPolishReason = polishReason?.trim().replace(/[.]+$/g, "") ?? "improved English fluency without changing the meaning";

  if (!baseReason) {
    return `Surface polish: ${normalizedPolishReason}.`;
  }

  if (baseReason.toLowerCase().includes(normalizedPolishReason.toLowerCase())) {
    return baseReason;
  }

  return `${baseReason.replace(/\s+$/, "").replace(/[.]+$/g, ".")} Surface polish: ${normalizedPolishReason}.`;
}

function extractCapitalizedPhrases(value: string) {
  const matches = value.match(/\b[A-Z][A-Za-z0-9']*(?:\s+[A-Z][A-Za-z0-9']*){0,3}\b/g) ?? [];
  return matches.map((match) => match.trim()).filter(Boolean);
}

function extractProtectedAnchors(
  sourceLine: SourceDraftLine,
  draftLine: AiDraftLine,
  lineWorldModel: AiWorldModelLine | null | undefined
) {
  const anchors = new Set<string>();
  const chosen = draftLine.chosen.trim();
  const normalizedChosen = normalizeEnglishChoiceKey(chosen);
  const normalizedOriginal = normalizeLineKey(sourceLine.original);

  if (normalizedOriginal && normalizedChosen.includes(normalizedOriginal) && sourceLine.original.trim().length >= 5) {
    anchors.add(sourceLine.original.trim());
  }

  for (const phrase of extractCapitalizedPhrases(chosen)) {
    if (phrase.length >= 3) {
      anchors.add(phrase);
    }
  }

  const specialTokens = chosen.match(/\b[A-Za-z0-9]*\d+[A-Za-z0-9-]*\b/g) ?? [];
  for (const token of specialTokens) {
    anchors.add(token.trim());
  }

  for (const referent of lineWorldModel?.referents ?? []) {
    const normalizedReferent = normalizeEnglishChoiceKey(referent);
    if (normalizedReferent && normalizedChosen.includes(normalizedReferent)) {
      anchors.add(referent);
    }
  }

  for (const imagery of lineWorldModel?.imagery ?? []) {
    const normalizedImagery = normalizeEnglishChoiceKey(imagery);
    if (normalizedImagery && normalizedChosen.includes(normalizedImagery)) {
      anchors.add(imagery);
    }
  }

  return Array.from(anchors).slice(0, 6);
}

function preservesProtectedAnchors(candidate: string, protectedAnchors: string[]) {
  const normalizedCandidate = normalizeEnglishChoiceKey(candidate);

  if (!normalizedCandidate) {
    return protectedAnchors.length === 0;
  }

  return protectedAnchors.every((anchor) => {
    const normalizedAnchor = normalizeEnglishChoiceKey(anchor);
    return !normalizedAnchor || normalizedCandidate.includes(normalizedAnchor);
  });
}

function isLikelyHookOrChant(sourceLine: SourceDraftLine, draftLine: AiDraftLine) {
  const normalizedOriginal = normalizeLineKey(sourceLine.original);
  const normalizedChosen = normalizeEnglishChoiceKey(draftLine.chosen);
  const tokenCount = tokenizeEnglishHint(draftLine.chosen).length;

  if (!normalizedOriginal || !normalizedChosen) {
    return false;
  }

  return tokenCount <= 5 && normalizedChosen.includes(normalizedOriginal);
}

function isSurfacePolishEligible(sourceLine: SourceDraftLine, draftLine: AiDraftLine) {
  if (draftLine.selectorReason === "Manually reviewed in Lafz.") {
    return false;
  }

  if (draftLine.confidence === "low") {
    return false;
  }

  if (!isMeaningfulSourceLine(sourceLine.original)) {
    return false;
  }

  if (isAdlibLikeText(draftLine.chosen)) {
    return false;
  }

  if (isLikelyHookOrChant(sourceLine, draftLine)) {
    return false;
  }

  return tokenizeEnglishHint(draftLine.chosen).length >= 5;
}

function scoreCandidateAgainstAnchor(
  candidate: string,
  line: Pick<AiDraftLine, "meaning" | "impliedMeaning" | "register">,
  verseState: AiVerseState | null | undefined
) {
  const candidateTokens = new Set(tokenizeEnglishHint(candidate));
  const anchorTokens = new Set(
    tokenizeEnglishHint(
      [line.meaning, line.impliedMeaning ?? "", line.register ?? "", verseState?.summary ?? "", ...(verseState?.dominantIntents ?? [])]
        .join(" ")
        .trim()
    )
  );

  if (candidateTokens.size === 0 || anchorTokens.size === 0) {
    return 0;
  }

  const shared = [...candidateTokens].filter((token) => anchorTokens.has(token)).length;
  return shared;
}

function hasSuspiciousDuplicateChoice(
  chosen: string,
  original: string,
  seenChoices: Map<string, Array<{ order: number; original: string }>>
) {
  const chosenKey = normalizeEnglishChoiceKey(chosen);

  if (!chosenKey || chosenKey.length < 10) {
    return false;
  }

  const seen = seenChoices.get(chosenKey) ?? [];
  return seen.some((entry) => entry.original.trim() !== original.trim());
}

function getEvaluatorScoreBonus(
  score:
    | {
        semanticAccuracy: number;
        contextFit: number;
        perspectiveFidelity: number;
        repetitionRisk: number;
        driftRisk: number;
      }
    | null
    | undefined
) {
  if (!score) {
    return 0;
  }

  return score.semanticAccuracy * 3 + score.contextFit * 2 + score.perspectiveFidelity * 2 - score.repetitionRisk * 2 - score.driftRisk * 3;
}

function chooseGuardrailedEvaluatedLine(options: {
  sourceLine: SourceDraftLine;
  selectedLine: AiDraftLine;
  generatorALine: AiDraftLine | undefined;
  generatorBLine: AiDraftLine | undefined;
  evaluationLine:
    | {
        winner: "generator_a" | "generator_b" | "blended";
        chosen: string;
        confidence: "low" | "medium" | "high";
        ambiguity: string | null;
        note: string | null;
        selectorReason: string | null;
        suspiciousDuplicate: boolean;
        adlibCollapseRisk: boolean;
        semanticDriftRisk: boolean;
        scoreA: {
          semanticAccuracy: number;
          contextFit: number;
          perspectiveFidelity: number;
          repetitionRisk: number;
          driftRisk: number;
        } | null;
        scoreB: {
          semanticAccuracy: number;
          contextFit: number;
          perspectiveFidelity: number;
          repetitionRisk: number;
          driftRisk: number;
        } | null;
  }
    | undefined;
  verseState: AiVerseState | null | undefined;
  seenChoices: Map<string, Array<{ order: number; original: string }>>;
}): AiDraftLine {
  const candidates = [
    options.generatorALine
      ? {
          key: "generator_a" as const,
          line: options.generatorALine,
          evaluatorScore: getEvaluatorScoreBonus(options.evaluationLine?.scoreA)
        }
      : null,
    options.generatorBLine
      ? {
          key: "generator_b" as const,
          line: options.generatorBLine,
          evaluatorScore: getEvaluatorScoreBonus(options.evaluationLine?.scoreB)
        }
      : null,
    {
      key: "selected" as const,
      line: options.selectedLine,
      evaluatorScore:
        options.evaluationLine?.winner === "generator_a"
          ? getEvaluatorScoreBonus(options.evaluationLine?.scoreA)
          : options.evaluationLine?.winner === "generator_b"
            ? getEvaluatorScoreBonus(options.evaluationLine?.scoreB)
            : Math.max(
                getEvaluatorScoreBonus(options.evaluationLine?.scoreA),
                getEvaluatorScoreBonus(options.evaluationLine?.scoreB)
              )
    }
  ].filter((entry): entry is { key: "generator_a" | "generator_b" | "selected"; line: AiDraftLine; evaluatorScore: number } => Boolean(entry));

  const scored = candidates.map((candidate) => {
    const duplicatePenalty = hasSuspiciousDuplicateChoice(candidate.line.chosen, options.sourceLine.original, options.seenChoices) ? 12 : 0;
    const adlibPenalty =
      isMeaningfulSourceLine(options.sourceLine.original) && isAdlibLikeText(candidate.line.chosen)
        ? 16
        : 0;
    const selectedOnlyPenalty =
      candidate.key === "selected"
        ? (options.evaluationLine?.suspiciousDuplicate ? 8 : 0) +
          (options.evaluationLine?.adlibCollapseRisk ? 10 : 0) +
          (options.evaluationLine?.semanticDriftRisk ? 8 : 0)
        : 0;
    const anchorScore = scoreCandidateAgainstAnchor(candidate.line.chosen, candidate.line, options.verseState);

    return {
      ...candidate,
      duplicatePenalty,
      adlibPenalty,
      selectedOnlyPenalty,
      anchorScore,
      totalScore: candidate.evaluatorScore + anchorScore * 2 - duplicatePenalty - adlibPenalty - selectedOnlyPenalty
    };
  });

  const current = scored.find((candidate) => candidate.key === "selected");
  const best = [...scored].sort((left, right) => right.totalScore - left.totalScore)[0] ?? current;

  if (!best || !current) {
    return options.selectedLine;
  }

  const shouldOverride =
    current.adlibPenalty > 0 ||
    current.duplicatePenalty > 0 ||
    current.selectedOnlyPenalty >= 8 ||
    best.totalScore >= current.totalScore + 4;

  if (!shouldOverride || best.key === "selected") {
    return {
      ...options.selectedLine,
      confidence:
        current.adlibPenalty > 0 || current.duplicatePenalty > 0 || current.selectedOnlyPenalty > 0
          ? options.selectedLine.confidence === "high"
            ? "medium"
            : options.selectedLine.confidence
          : options.selectedLine.confidence
    };
  }

  const guardrailReasonParts = [];
  if (current.duplicatePenalty > 0 || options.evaluationLine?.suspiciousDuplicate) {
    guardrailReasonParts.push("avoided a suspicious duplicate");
  }
  if (current.adlibPenalty > 0 || options.evaluationLine?.adlibCollapseRisk) {
    guardrailReasonParts.push("avoided collapsing a full line into an ad-lib");
  }
  if (current.selectedOnlyPenalty > 0 || options.evaluationLine?.semanticDriftRisk) {
    guardrailReasonParts.push("stayed closer to the verse meaning");
  }

  return {
    ...best.line,
    confidence: best.line.confidence === "high" ? "high" : "medium",
    selectorReason: guardrailReasonParts.length > 0 ? `Guardrail: ${guardrailReasonParts.join("; ")}.` : best.line.selectorReason,
    selectionWinner: best.key === "generator_a" ? "generator_a" : best.key === "generator_b" ? "generator_b" : options.selectedLine.selectionWinner
  };
}

type GeminiComparisonResultLine = Awaited<ReturnType<typeof requestGeminiDraftComparison>>["lines"][number];

function isRecoverableGeminiComparisonError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /invalid comparison shape|changed the lyric line count|invalid comparison line|non-object comparison line|could not be parsed|empty response|timeout|timed out|aborted|fetch failed|connect/i.test(
    message
  );
}

function getConfidenceScore(confidence: AiDraftLine["confidence"]) {
  switch (confidence) {
    case "high":
      return 6;
    case "medium":
      return 3;
    case "low":
      return 0;
    default:
      return 0;
  }
}

function buildLocalGeminiFallbackLine(options: {
  sourceLine: SourceDraftLine;
  generatorALine: AiDraftLine | undefined;
  generatorBLine: AiDraftLine | undefined;
  verseState: AiVerseState | null | undefined;
  seenChoices: Map<string, Array<{ order: number; original: string }>>;
  errorMessage: string;
}): GeminiComparisonResultLine {
  const candidates = [
    options.generatorALine ? { key: "generator_a" as const, line: options.generatorALine } : null,
    options.generatorBLine ? { key: "generator_b" as const, line: options.generatorBLine } : null
  ].filter((entry): entry is { key: "generator_a" | "generator_b"; line: AiDraftLine } => Boolean(entry));

  if (candidates.length === 0) {
    throw new Error("Lafz could not build a local fallback because neither generator produced a line.");
  }

  const scored = candidates.map((candidate) => {
    const duplicatePenalty = hasSuspiciousDuplicateChoice(
      candidate.line.chosen,
      options.sourceLine.original,
      options.seenChoices
    )
      ? 12
      : 0;
    const adlibPenalty =
      isMeaningfulSourceLine(options.sourceLine.original) && isAdlibLikeText(candidate.line.chosen) ? 16 : 0;
    const anchorScore = scoreCandidateAgainstAnchor(candidate.line.chosen, candidate.line, options.verseState);

    return {
      ...candidate,
      duplicatePenalty,
      adlibPenalty,
      anchorScore,
      totalScore: anchorScore * 2 + getConfidenceScore(candidate.line.confidence) - duplicatePenalty - adlibPenalty
    };
  });

  const best = [...scored].sort((left, right) => right.totalScore - left.totalScore)[0] ?? scored[0];
  const reasonParts = ["Local fallback: Gemini judge returned an invalid comparison response"];

  if (best.duplicatePenalty > 0) {
    reasonParts.push("avoided a suspicious duplicate");
  }

  if (best.adlibPenalty > 0) {
    reasonParts.push("avoided collapsing the lyric into an ad-lib");
  }

  return {
    winner: best.key,
    chosen: best.line.chosen,
    confidence: best.line.confidence === "high" ? "medium" : best.line.confidence,
    ambiguity: best.line.ambiguity,
    note: best.line.note,
    selectorReason: `${reasonParts.join("; ")}. (${options.errorMessage.slice(0, 140)})`,
    suspiciousDuplicate: best.duplicatePenalty > 0,
    adlibCollapseRisk: best.adlibPenalty > 0,
    semanticDriftRisk: false,
    scoreA: null,
    scoreB: null
  };
}

async function requestGeminiDraftComparisonWithRecovery(options: {
  request: Parameters<typeof requestGeminiDraftComparison>[0];
  sourceLines: SourceDraftLine[];
  generatorALines: Array<AiDraftLine | undefined>;
  generatorBLines: Array<AiDraftLine | undefined>;
  verseStateLookup: Map<number, AiVerseState>;
  seenChoices: Map<string, Array<{ order: number; original: string }>>;
  usageSink?: { inputTokens: number; outputTokens: number };
  retryAttempt?: number;
}): Promise<{
  model: string;
  sourceLanguage: string;
  lines: GeminiComparisonResultLine[];
}> {
  try {
    return await requestGeminiDraftComparison(options.request, options.usageSink);
  } catch (error) {
    if (!isRecoverableGeminiComparisonError(error)) {
      throw annotateProviderStageError("Gemini", "draft comparison", error);
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const retryAttempt = options.retryAttempt ?? 0;

    if (retryAttempt < 1) {
      console.warn("[lafz] Retrying Gemini comparison batch after invalid response shape.");
      return requestGeminiDraftComparisonWithRecovery({
        ...options,
        retryAttempt: retryAttempt + 1
      });
    }

    if (options.request.lines.length > 1) {
      const midpoint = Math.ceil(options.request.lines.length / 2);
      console.warn(
        `[lafz] Gemini comparison batch still invalid after retry; splitting ${options.request.lines.length} lines into ${midpoint} and ${
          options.request.lines.length - midpoint
        }.`
      );

      const left = await requestGeminiDraftComparisonWithRecovery({
        ...options,
        request: {
          ...options.request,
          lines: options.request.lines.slice(0, midpoint)
        },
        sourceLines: options.sourceLines.slice(0, midpoint),
        generatorALines: options.generatorALines.slice(0, midpoint),
        generatorBLines: options.generatorBLines.slice(0, midpoint),
        retryAttempt: 0
      });
      const right = await requestGeminiDraftComparisonWithRecovery({
        ...options,
        request: {
          ...options.request,
          lines: options.request.lines.slice(midpoint)
        },
        sourceLines: options.sourceLines.slice(midpoint),
        generatorALines: options.generatorALines.slice(midpoint),
        generatorBLines: options.generatorBLines.slice(midpoint),
        retryAttempt: 0
      });

      return {
        model: left.model || right.model,
        sourceLanguage: left.sourceLanguage || right.sourceLanguage || options.request.sourceLanguage,
        lines: [...left.lines, ...right.lines]
      };
    }

    console.warn("[lafz] Gemini comparison fell back to a local selector for one line.");
    return {
      model: "local_fallback_after_gemini_error",
      sourceLanguage: options.request.sourceLanguage,
      lines: [
        buildLocalGeminiFallbackLine({
          sourceLine: options.sourceLines[0],
          generatorALine: options.generatorALines[0],
          generatorBLine: options.generatorBLines[0],
          verseState: options.verseStateLookup.get(options.sourceLines[0]?.order ?? -1) ?? null,
          seenChoices: options.seenChoices,
          errorMessage
        })
      ]
    };
  }
}

async function applySurfacePolishToDraftLines(options: {
  title: string;
  artist: string;
  album: string;
  sourceLanguage: string;
  targetLanguage: string;
  songContext: AiSongContext | null;
  worldModel: AiWorldModel | null;
  artistMemory: Awaited<ReturnType<typeof getAiArtistMemory>>["memory"];
  sourceLines: SourceDraftLine[];
  draftLines: AiDraftLine[];
  verseStateLookup: Map<number, AiVerseState>;
  worldModelLineLookup: Map<number, AiWorldModelLine>;
}) {
  const sourceLineByOrder = new Map(options.sourceLines.map((line) => [line.order, line]));
  const sortedDraftLines = [...options.draftLines].sort((left, right) => left.order - right.order);
  const representativeKeys = new Set<string>();
  const polishCandidates: Array<{
    key: string;
    line: AiDraftLine;
    sourceLine: SourceDraftLine;
    protectedAnchors: string[];
    verseState: AiVerseState | null;
    lineWorldModel: AiWorldModelLine | null;
  }> = [];

  for (const line of sortedDraftLines) {
    const sourceLine = sourceLineByOrder.get(line.order);
    if (!sourceLine) {
      continue;
    }

    const key = normalizeLineKey(sourceLine.original) || `line:${line.order}`;
    if (representativeKeys.has(key)) {
      continue;
    }
    representativeKeys.add(key);

    if (!isSurfacePolishEligible(sourceLine, line)) {
      continue;
    }

    polishCandidates.push({
      key,
      line,
      sourceLine,
      protectedAnchors: extractProtectedAnchors(sourceLine, line, options.worldModelLineLookup.get(line.order) ?? null),
      verseState: options.verseStateLookup.get(line.order) ?? null,
      lineWorldModel: options.worldModelLineLookup.get(line.order) ?? null
    });
  }

  if (polishCandidates.length === 0) {
    return options.draftLines;
  }

  const polishedByKey = new Map<string, AiDraftLine>();

  for (const batch of chunkArray(polishCandidates, SURFACE_POLISH_BATCH_SIZE)) {
    let polishResponse: Awaited<ReturnType<typeof requestOpenAiSurfacePolish>> | null = null;
    let auditResponse: Awaited<ReturnType<typeof requestOpenAiSurfacePolishAudit>> | null = null;

    try {
      const resolvedPolishResponse = await withProviderStageRetry({
        provider: "OpenAI",
        stage: "surface polish",
        retries: 1,
        action: () =>
          requestOpenAiSurfacePolish({
            title: options.title,
            artist: options.artist,
            album: options.album,
            sourceLanguage: options.sourceLanguage,
            targetLanguage: options.targetLanguage,
            glossaryEntries: [],
            songContext: options.songContext,
            worldModel: options.worldModel,
            artistMemory: options.artistMemory,
            lines: batch.map(({ line, sourceLine, protectedAnchors, verseState, lineWorldModel }) => ({
              index: line.order + 1,
              original: sourceLine.original,
              chosen: line.chosen,
              meaning: line.meaning,
              impliedMeaning: line.impliedMeaning,
              register: line.register,
              contextBefore: buildRefinementContext(sortedDraftLines, line.order, -CONTEXT_WINDOW_LINES, -1),
              contextAfter: buildRefinementContext(sortedDraftLines, line.order, 1, CONTEXT_WINDOW_LINES),
              verseState,
              lineWorldModel,
              protectedAnchors
            }))
          })
      });
      polishResponse = resolvedPolishResponse;

      auditResponse = await withProviderStageRetry({
        provider: "OpenAI",
        stage: "surface polish audit",
        retries: 1,
        action: () =>
          requestOpenAiSurfacePolishAudit({
            title: options.title,
            artist: options.artist,
            album: options.album,
            sourceLanguage: options.sourceLanguage,
            targetLanguage: options.targetLanguage,
            glossaryEntries: [],
            songContext: options.songContext,
            worldModel: options.worldModel,
            artistMemory: options.artistMemory,
            lines: batch.map(({ line, sourceLine, protectedAnchors, verseState, lineWorldModel }, index) => ({
              index: line.order + 1,
              original: sourceLine.original,
              originalChosen: line.chosen,
              safePolish: resolvedPolishResponse.lines[index]?.safePolish ?? line.chosen,
              naturalPolish: resolvedPolishResponse.lines[index]?.naturalPolish ?? line.chosen,
              meaning: line.meaning,
              impliedMeaning: line.impliedMeaning,
              register: line.register,
              verseState,
              lineWorldModel,
              protectedAnchors
            }))
          })
      });
    } catch (error) {
      console.warn(`[lafz] Skipping surface polish batch after provider error: ${getAiPipelineErrorMessage(error)}`);
      continue;
    }

    if (!polishResponse || !auditResponse) {
      continue;
    }

    for (const [index, candidate] of batch.entries()) {
      const proposal = polishResponse.lines[index];
      const audit = auditResponse.lines[index];
      if (!proposal || !audit) {
        continue;
      }

      const evaluation = evaluateSurfacePolishCandidate({
        sourceLine: candidate.sourceLine,
        draftLine: candidate.line,
        proposal,
        audit,
        verseState: candidate.verseState,
        lineWorldModel: candidate.lineWorldModel
      });

      if (!evaluation.applied) {
        continue;
      }

      polishedByKey.set(candidate.key, {
        ...candidate.line,
        ...evaluation.line
      });
    }
  }

  if (polishedByKey.size === 0) {
    return options.draftLines;
  }

  const updatedLines = sortedDraftLines.map((line) => {
    const key = normalizeLineKey(line.original) || `line:${line.order}`;
    return polishedByKey.get(key) ?? line;
  });

  return applyDuplicateLineReuse(updatedLines);
}

async function evaluateDraftAlternativesInBatches(
  options: GenerateAiTranslationOptions,
  sourceLines: SourceDraftLine[],
  sourceLyricsKind: "synced" | "plain",
  sourceLanguage: string,
  songContext: AiSongContext | null,
  worldModel: AiWorldModel | null,
  artistMemory: Awaited<ReturnType<typeof getAiArtistMemory>>["memory"],
  preferredRenderings: AiGlossaryEntry[],
  artistCorrectionExamples: AiCorrectionExample[],
  trackCorrectionExamples: AiCorrectionExample[],
  normalizedSourceLookup: Map<number, NormalizedSourceLine>,
  verseStateLookup: Map<number, AiVerseState>,
  worldModelLineLookup: Map<number, AiWorldModelLine>,
  generatorALines: AiDraftLine[],
  generatorBLines: AiDraftLine[],
  usageSink?: { inputTokens: number; outputTokens: number },
  previousDraftLookup?: Map<number, PreviousTranslationRef>
) {
  const batchSize = getComparisonBatchSize(sourceLyricsKind, sourceLines.length);
  const batches = chunkSourceLines(sourceLines, batchSize);
  const comparisonContextWindow = getComparisonContextWindowLines(sourceLines.length);
  const evaluatedLines: AiDraftLine[] = [];
  const seenChoices = new Map<string, Array<{ order: number; original: string }>>();
  let model = "";

  const glossaryEntries = await loadRelevantGlossaryEntries({
    sourceLanguage,
    artist: options.artist,
    spotifyTrackId: options.spotifyTrackId,
    candidateTexts: sourceLines.flatMap((line) => [
      line.original,
      generatorALines[line.order]?.chosen ?? "",
      generatorBLines[line.order]?.chosen ?? "",
      generatorALines[line.order]?.literal ?? "",
      generatorBLines[line.order]?.literal ?? ""
    ]),
    preferredRenderings
  });
  const correctionExamples = mergeCorrectionExampleSources([
    trackCorrectionExamples.map((example) => ({ ...example, source: "track_memory" as const })),
    artistCorrectionExamples.map((example) => ({ ...example, source: "artist_memory" as const }))
  ]);

  for (const batch of batches) {

    const comparisonLines = batch.map((line) => {
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
        contextBefore: buildRefinementContext(generatorALines, line.order, -comparisonContextWindow, -1),
        contextAfter: buildRefinementContext(generatorALines, line.order, 1, comparisonContextWindow),
        verseState: verseStateLookup.get(line.order) ?? null,
        lineWorldModel: worldModelLineLookup.get(line.order) ?? null,
        matchingCorrections: buildMatchingCorrectionHints(correctionExamples, [
          line.original,
          generatorALine?.chosen ?? "",
          generatorBLines[line.order]?.chosen ?? "",
          ...buildContextLines(sourceLines, line.order, -comparisonContextWindow, -1),
          ...buildContextLines(sourceLines, line.order, 1, comparisonContextWindow)
        ]),
        previousTranslation: previousDraftLookup?.get(line.order) ?? null
      };
    });

    const batchGeneratorALines = batch.map((line) => generatorALines[line.order]);
    const batchGeneratorBLines = batch.map((line) => generatorBLines[line.order]);

    const aiResponse = await requestGeminiDraftComparisonWithRecovery({
      request: {
        title: options.title,
        artist: options.artist,
        album: options.album,
        sourceLanguage,
        targetLanguage: normalizeLanguage(options.targetLanguage),
        glossaryEntries,
        songContext,
        worldModel,
        artistMemory,
        lines: comparisonLines
      },
      sourceLines: batch,
      generatorALines: batchGeneratorALines,
      generatorBLines: batchGeneratorBLines,
      verseStateLookup,
      seenChoices,
      usageSink
    });
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

        const selectedLine = {
          ...baseLine,
          chosen: evaluationLine?.chosen ?? baseLine.chosen,
          note: evaluationLine?.note ?? baseLine.note,
          ambiguity: evaluationLine?.ambiguity ?? baseLine.ambiguity,
          confidence: evaluationLine?.confidence ?? baseLine.confidence,
          selectorReason: evaluationLine?.selectorReason ?? baseLine.selectorReason,
          selectionWinner: evaluationLine?.winner ?? baseLine.selectionWinner ?? null,
          startMs: line.startMs,
          endMs: line.endMs
        } satisfies AiDraftLine;

        const guardrailedLine = chooseGuardrailedEvaluatedLine({
          sourceLine: line,
          selectedLine,
          generatorALine,
          generatorBLine,
          evaluationLine,
          verseState: verseStateLookup.get(line.order) ?? null,
          seenChoices
        });

        const chosenKey = normalizeEnglishChoiceKey(guardrailedLine.chosen);
        if (chosenKey) {
          const entries = seenChoices.get(chosenKey) ?? [];
          entries.push({ order: line.order, original: line.original });
          seenChoices.set(chosenKey, entries);
        }

        return guardrailedLine;
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

function normalizeTranslationText(value: string | undefined) {
  return (value ?? "").trim();
}

function areTrackTranslationsEquivalent(left: TrackTranslation | null | undefined, right: TrackTranslation | null | undefined) {
  if (!left || !right) {
    return false;
  }

  if (
    left.spotifyTrackId !== right.spotifyTrackId ||
    normalizeTranslationText(left.title) !== normalizeTranslationText(right.title) ||
    normalizeTranslationText(left.artist) !== normalizeTranslationText(right.artist) ||
    normalizeTranslationText(left.sourceLanguage) !== normalizeTranslationText(right.sourceLanguage) ||
    normalizeTranslationText(left.targetLanguage) !== normalizeTranslationText(right.targetLanguage) ||
    left.lines.length !== right.lines.length
  ) {
    return false;
  }

  return left.lines.every((line, index) => {
    const other = right.lines[index];

    if (!other) {
      return false;
    }

    return (
      line.startMs === other.startMs &&
      line.endMs === other.endMs &&
      normalizeTranslationText(line.original) === normalizeTranslationText(other.original) &&
      normalizeTranslationText(line.translated) === normalizeTranslationText(other.translated) &&
      normalizeTranslationText(line.transliteration) === normalizeTranslationText(other.transliteration) &&
      normalizeTranslationText(line.note) === normalizeTranslationText(other.note)
    );
  });
}

async function shouldRefreshPublishedTranslation(options: {
  overwriteExistingTranslation: boolean;
  translationInspectionKind: "missing" | "stub" | "translated" | "malformed";
  spotifyTrackId: string;
  previousDraft: AiTranslationDraftFile | null;
}) {
  if (!shouldPreserveExistingTranslationFile(options.translationInspectionKind, options.overwriteExistingTranslation)) {
    return true;
  }

  if (options.translationInspectionKind !== "translated") {
    return false;
  }

  const previousDraftPlayback = options.previousDraft ? buildTrackTranslationFromAiDraft(options.previousDraft) : null;

  if (!previousDraftPlayback) {
    return false;
  }

  const existingTranslation = await getTranslationByTrackId(options.spotifyTrackId).catch(() => null);
  return areTrackTranslationsEquivalent(existingTranslation, previousDraftPlayback);
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
      note: line.note ?? bestCorrection.note ?? null,
      confidence: bestCorrection.similarity === "exact" ? "high" : line.confidence === "low" ? "medium" : line.confidence,
      selectorReason:
        bestCorrection.similarity === "exact"
          ? "Matched a repeated line you already corrected."
          : "Aligned with a similar line you already corrected.",
      selectionWinner: line.selectionWinner ?? null
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
    normalizedSourceLookup
  );
  const sourceGroups = buildSourceLineGroups(sourceLines, lyricsCache.kind);
  const worldModelResponse = await generateWorldModel(
    options,
    sourceLines,
    meaningResponse.sourceLanguage,
    contextResponse.songContext,
    contextResponse.artistMemory,
    contextResponse.preferredRenderings,
    normalizedSourceLookup,
    sourceGroups,
    meaningResponse.lines
  );
  const verseStates = deriveVerseStatesFromWorldModel(worldModelResponse.worldModel);
  const verseStateLookup = buildVerseStateLookup(verseStates);
  const worldModelLineLookup = buildWorldModelLineLookup(worldModelResponse.worldModel);

  if (!isAiConfigured()) {
    return {
      status: "missing_ai_config"
    };
  }

  let aiResponse: {
    model: string;
    sourceLanguage: string;
    lines: AiDraftLine[];
  };
  let pipelineCostSummary: AiCostSummary | undefined;
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

  const geminiGeneratorARequester: DraftRequester = async (opts) => {
    const t0 = Date.now();
    const result = await requestGeminiTranslationDraft({ ...opts, draftVariant: "generator_a" }, usageSinkA);
    genADurationMs += Date.now() - t0;
    genAModel = result.model;
    return result;
  };

  const geminiGeneratorBRequester: DraftRequester = async (opts) => {
    const t0 = Date.now();
    const result = await requestGeneratorBTranslationDraftWithFallback(opts, usageSinkB);
    genBDurationMs += Date.now() - t0;
    genBModel = result.model;
    return result;
  };

  const generatorARequester = openAiRequester;
  const generatorBRequester = geminiGeneratorBRequester;
  const generatorAProviderLabel = "OpenAI";
  const generatorBProviderLabel = "Gemini";

  const [generatorAInitialDraft, generatorBInitialDraft] = await Promise.all([
    generateDraftLinesInBatches(
      options,
      sourceLines,
      lyricsCache.kind,
      meaningResponse.sourceLanguage,
      contextResponse.songContext,
      worldModelResponse.worldModel,
      contextResponse.artistMemory,
      contextResponse.preferredRenderings,
      contextResponse.artistCorrectionExamples,
      contextResponse.trackCorrectionExamples,
      normalizedSourceLookup,
      verseStateLookup,
      worldModelLineLookup,
      meaningResponse.lines,
      generatorAProviderLabel,
      "generator A",
      generatorARequester,
      previousDraftLookup
    ),
    retryGeminiGeneratorB(() =>
      generateDraftLinesInBatches(
        options,
        sourceLines,
        lyricsCache.kind,
        meaningResponse.sourceLanguage,
        contextResponse.songContext,
        worldModelResponse.worldModel,
        contextResponse.artistMemory,
        contextResponse.preferredRenderings,
        contextResponse.artistCorrectionExamples,
        contextResponse.trackCorrectionExamples,
        normalizedSourceLookup,
        verseStateLookup,
        worldModelLineLookup,
        meaningResponse.lines,
        generatorBProviderLabel,
        "generator B",
        generatorBRequester,
        previousDraftLookup
      )
    )
  ]);

  const geminiT0 = Date.now();
  const evaluatedDraft = await evaluateDraftAlternativesInBatches(
    options,
    sourceLines,
    lyricsCache.kind,
    generatorAInitialDraft.sourceLanguage || generatorBInitialDraft.sourceLanguage || meaningResponse.sourceLanguage,
    contextResponse.songContext,
    worldModelResponse.worldModel,
    contextResponse.artistMemory,
    contextResponse.preferredRenderings,
    contextResponse.artistCorrectionExamples,
    contextResponse.trackCorrectionExamples,
    normalizedSourceLookup,
    verseStateLookup,
    worldModelLineLookup,
    generatorAInitialDraft.lines,
    generatorBInitialDraft.lines,
    usageSinkG,
    previousDraftLookup
  );
  genGDurationMs = Date.now() - geminiT0;
  const polishedLines = await applySurfacePolishToDraftLines({
    title: options.title,
    artist: options.artist,
    album: options.album,
    sourceLanguage: generatorAInitialDraft.sourceLanguage || generatorBInitialDraft.sourceLanguage || meaningResponse.sourceLanguage,
    targetLanguage,
    songContext: contextResponse.songContext,
    worldModel: worldModelResponse.worldModel,
    artistMemory: contextResponse.artistMemory,
    sourceLines,
    draftLines: evaluatedDraft.lines,
    verseStateLookup,
    worldModelLineLookup
  });
  const pipelineDurationMs = Date.now() - pipelineStartMs;

  const evalLines = polishedLines;
  let winnerA = 0;
  let winnerB = 0;
  let winnerBlend = 0;
  let confHigh = 0;
  let confMed = 0;
  let confLow = 0;

  for (const line of evalLines) {
    if (line.selectionWinner === "generator_b") winnerB++;
    else if (line.selectionWinner === "blended") winnerBlend++;
    else winnerA++;

    if (line.confidence === "high") confHigh++;
    else if (line.confidence === "medium") confMed++;
    else confLow++;
  }

  const costA = calcModelCost("openai", usageSinkA.inputTokens, usageSinkA.outputTokens);
  const costB = calcModelCost("gemini", usageSinkB.inputTokens, usageSinkB.outputTokens);
  const costG = calcModelCost("gemini", usageSinkG.inputTokens, usageSinkG.outputTokens);
  pipelineCostSummary = {
    generatorA: { model: genAModel, inputTokens: usageSinkA.inputTokens, outputTokens: usageSinkA.outputTokens, costUsd: costA },
    generatorB: { model: genBModel, inputTokens: usageSinkB.inputTokens, outputTokens: usageSinkB.outputTokens, costUsd: costB },
    judge: { model: evaluatedDraft.model, inputTokens: usageSinkG.inputTokens, outputTokens: usageSinkG.outputTokens, costUsd: costG },
    totalCostUsd: costA + costB + costG
  };

  queueUsageTracking({
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
    judge: { model: evaluatedDraft.model, inputTokens: usageSinkG.inputTokens, outputTokens: usageSinkG.outputTokens, durationMs: genGDurationMs },
    pipelineDurationMs
  });

  aiResponse = {
    model: `A:${genAModel} | B:${genBModel} | Eval:${evaluatedDraft.model}`,
    sourceLanguage: generatorAInitialDraft.sourceLanguage || generatorBInitialDraft.sourceLanguage || meaningResponse.sourceLanguage,
    lines: polishedLines
  };

  const draftFile: AiTranslationDraftFile = {
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
      provider: "multi",
      model: aiResponse.model
    },
    songContext: contextResponse.songContext,
    worldModel: worldModelResponse.worldModel,
    verseStates,
    artistMemory: contextResponse.artistMemory,
    lines: aiResponse.lines
  };

  const draftFilePath = await writeAiTranslationDraftFile(draftFile);

  if (lyricsCache.kind === "plain") {
    queuePostGenerationTasks(options, draftFile, pipelineCostSummary, generationStartMs, "draft_only_plain");
    return {
      status: "draft_only_plain",
      draftFilePath,
      lineCount: draftFile.lines.length,
      costSummary: pipelineCostSummary
    };
  }

  const translationInspection = await inspectTranslationFile(options.spotifyTrackId);
  const refreshPublishedTranslation = await shouldRefreshPublishedTranslation({
    overwriteExistingTranslation: options.overwriteExistingTranslation,
    translationInspectionKind: translationInspection.kind,
    spotifyTrackId: options.spotifyTrackId,
    previousDraft
  });

  if (!refreshPublishedTranslation) {
    queuePostGenerationTasks(options, draftFile, pipelineCostSummary, generationStartMs, "draft_only_preserved");
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

  queuePostGenerationTasks(options, draftFile, pipelineCostSummary, generationStartMs, "saved_translation");
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
  const verseStateLookup = buildVerseStateLookup(draft.verseStates);
  const worldModelLineLookup = buildWorldModelLineLookup(draft.worldModel);

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
    memory: loadedArtistMemory,
    preferredRenderings: loadedPreferredRenderings,
    correctionExamples: artistCorrectionExamples
  } = await getHydratedArtistMemory(draft.artist);
  const trackCorrectionExamples = await getTrackCorrectionExamples(draft.spotifyTrackId).catch(() => []);
  const contextBefore = buildContextLines(allSourceLines, representativeSourceLine.order, -CONTEXT_WINDOW_LINES, -1);
  const contextAfter = buildContextLines(allSourceLines, representativeSourceLine.order, 1, CONTEXT_WINDOW_LINES);
  const candidateTexts = [representativeSourceLine.original, ...contextBefore, ...contextAfter];
  const brainPack = await buildSongTranslationMemoryPack({
    spotifyTrackId: draft.spotifyTrackId,
    artist: draft.artist,
    candidateTexts
  }).catch(() => null);
  const {
    artistMemory,
    preferredRenderings
  } = mergeBrainMemoryIntoArtistContext({
    artist: draft.artist,
    artistMemory: loadedArtistMemory,
    preferredRenderings: loadedPreferredRenderings,
    pack: brainPack
  });

  const correctionExamples = mergeCorrectionExampleSources([
    trackCorrectionExamples.map((e) => ({ ...e, source: "track_memory" as const })),
    artistCorrectionExamples.map((e) => ({ ...e, source: "artist_memory" as const }))
  ]);

  const matchingCorrections = buildMatchingCorrectionHints(correctionExamples, candidateTexts);

  const glossaryEntries = await loadRelevantGlossaryEntries({
    sourceLanguage: draft.sourceLanguage,
    artist: draft.artist,
    spotifyTrackId: draft.spotifyTrackId,
    candidateTexts,
    preferredRenderings
  });

  const normalizedLine = normalizedSourceLookup.get(representativeSourceLine.order);

  const usageSinkA = { inputTokens: 0, outputTokens: 0 };
  const usageSinkB = { inputTokens: 0, outputTokens: 0 };
  const usageSinkG = { inputTokens: 0, outputTokens: 0 };
  const verseState = verseStateLookup.get(representativeSourceLine.order) ?? null;
  const generatorARequester: DraftRequester = async (opts) => requestOpenAiTranslationDraft(opts, usageSinkA);

  const generatorBRequester: DraftRequester = async (opts) => requestGeneratorBTranslationDraftWithFallback(opts, usageSinkB);
  const generatorAProviderLabel = "OpenAI";
  const generatorBProviderLabel = "Gemini";

  const meaningResponse = await withProviderStageRetry({
    provider: "OpenAI",
    stage: "line regeneration meaning analysis",
    retries: 1,
    action: () =>
      requestOpenAiMeaningAnalysis({
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
      })
  });

  const meaningLine = meaningResponse.lines[0];
  const generatorAResponse = await withProviderStageRetry({
    provider: generatorAProviderLabel,
    stage: "line regeneration generator A",
    retries: 1,
    action: () =>
      generatorARequester({
        title: draft.title,
        artist: draft.artist,
        album: draft.album,
        sourceLanguage: draft.sourceLanguage,
        targetLanguage: draft.targetLanguage,
        includeTransliteration,
        includeNotes,
        glossaryEntries,
        songContext: draft.songContext,
        worldModel: draft.worldModel,
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
            verseState,
            lineWorldModel: worldModelLineLookup.get(representativeSourceLine.order) ?? null,
            matchingCorrections,
            previousTranslation: {
              chosen: primaryLine.chosen,
              confidence: primaryLine.confidence,
              manuallyReviewed: primaryLine.selectorReason === "Manually reviewed in Lafz."
            }
            }
          ]
      })
  });
  const generatorBResponse = await withProviderStageRetry({
    provider: generatorBProviderLabel,
    stage: "line regeneration generator B",
    retries: 1,
    action: () =>
      generatorBRequester({
        title: draft.title,
        artist: draft.artist,
        album: draft.album,
        sourceLanguage: draft.sourceLanguage,
        targetLanguage: draft.targetLanguage,
        includeTransliteration,
        includeNotes,
        glossaryEntries,
        songContext: draft.songContext,
        worldModel: draft.worldModel,
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
            verseState,
            lineWorldModel: worldModelLineLookup.get(representativeSourceLine.order) ?? null,
            matchingCorrections,
            previousTranslation: {
              chosen: primaryLine.chosen,
              confidence: primaryLine.confidence,
              manuallyReviewed: primaryLine.selectorReason === "Manually reviewed in Lafz."
            }
            }
          ]
      })
  });

  const generatorALineResponse = generatorAResponse.lines[0];
  const generatorBLineResponse = generatorBResponse.lines[0];

  if (!generatorALineResponse || !generatorBLineResponse) {
    throw new Error("AI returned no output for the regenerated line.");
  }

  const generatorALine: AiDraftLine = {
    order: representativeSourceLine.order,
    original: representativeSourceLine.original,
    normalizedOriginal: normalizedLine?.canonical ?? primaryLine.normalizedOriginal,
    normalizationNotes: normalizedLine?.notes ?? primaryLine.normalizationNotes,
    meaning: meaningLine?.meaning ?? primaryLine.meaning,
    impliedMeaning: meaningLine?.impliedMeaning ?? primaryLine.impliedMeaning,
    register: meaningLine?.register ?? primaryLine.register,
    literal: generatorALineResponse.literal,
    natural: generatorALineResponse.natural,
    slangAware: generatorALineResponse.slangAware,
    chosen: generatorALineResponse.chosen,
    transliteration: normalizeGeneratedTransliteration(
      representativeSourceLine.original,
      generatorALineResponse.transliteration ?? null
    ),
    note: generatorALineResponse.note ?? null,
    ambiguity: generatorALineResponse.ambiguity ?? null,
    confidence: generatorALineResponse.confidence,
    selectorReason: generatorALineResponse.selectorReason ?? null,
    selectionWinner: "generator_a",
    startMs: representativeSourceLine.startMs,
    endMs: representativeSourceLine.endMs
  };
  const generatorBLine: AiDraftLine = {
    ...generatorALine,
    literal: generatorBLineResponse.literal,
    natural: generatorBLineResponse.natural,
    slangAware: generatorBLineResponse.slangAware,
    chosen: generatorBLineResponse.chosen,
    transliteration: normalizeGeneratedTransliteration(
      representativeSourceLine.original,
      generatorBLineResponse.transliteration ?? null
    ),
    note: generatorBLineResponse.note ?? null,
    ambiguity: generatorBLineResponse.ambiguity ?? null,
    confidence: generatorBLineResponse.confidence,
    selectorReason: generatorBLineResponse.selectorReason ?? null,
    selectionWinner: "generator_b"
  };

  const comparisonResponse = await requestGeminiDraftComparisonWithRecovery({
    request: {
      title: draft.title,
      artist: draft.artist,
      album: draft.album,
      sourceLanguage: draft.sourceLanguage,
      targetLanguage: draft.targetLanguage,
      glossaryEntries,
      songContext: draft.songContext,
      worldModel: draft.worldModel,
      artistMemory,
      lines: [
        {
          index: representativeSourceLine.order + 1,
          original: representativeSourceLine.original,
          normalizedOriginal: normalizedLine?.canonical ?? null,
          meaning: meaningLine?.meaning ?? primaryLine.meaning,
          impliedMeaning: meaningLine?.impliedMeaning ?? primaryLine.impliedMeaning,
          register: meaningLine?.register ?? primaryLine.register,
          generatorA: {
            literal: generatorALine.literal,
            natural: generatorALine.natural,
            slangAware: generatorALine.slangAware,
            chosen: generatorALine.chosen,
            transliteration: generatorALine.transliteration,
            note: generatorALine.note,
            ambiguity: generatorALine.ambiguity,
            confidence: generatorALine.confidence
          },
          generatorB: {
            literal: generatorBLine.literal,
            natural: generatorBLine.natural,
            slangAware: generatorBLine.slangAware,
            chosen: generatorBLine.chosen,
            transliteration: generatorBLine.transliteration,
            note: generatorBLine.note,
            ambiguity: generatorBLine.ambiguity,
            confidence: generatorBLine.confidence
          },
          contextBefore: buildRefinementContext(sortedDraftLines, representativeSourceLine.order, -CONTEXT_WINDOW_LINES, -1),
          contextAfter: buildRefinementContext(sortedDraftLines, representativeSourceLine.order, 1, CONTEXT_WINDOW_LINES),
          verseState,
          lineWorldModel: worldModelLineLookup.get(representativeSourceLine.order) ?? null,
          matchingCorrections,
          previousTranslation: {
            chosen: primaryLine.chosen,
            confidence: primaryLine.confidence,
            manuallyReviewed: primaryLine.selectorReason === "Manually reviewed in Lafz."
          }
        }
      ]
    },
    sourceLines: [representativeSourceLine],
    generatorALines: [generatorALine],
    generatorBLines: [generatorBLine],
    verseStateLookup,
    seenChoices: new Map(),
    usageSink: usageSinkG
  });

  const evaluationLine = comparisonResponse.lines[0];
  const baseLine =
    evaluationLine?.winner === "generator_b"
      ? generatorBLine
      : chooseDraftBaseLine(evaluationLine?.chosen ?? generatorALine.chosen, generatorALine, generatorBLine);

  const selectedLine: AiDraftLine = {
    ...baseLine,
    chosen: evaluationLine?.chosen ?? baseLine.chosen,
    note: evaluationLine?.note ?? baseLine.note,
    ambiguity: evaluationLine?.ambiguity ?? baseLine.ambiguity,
    confidence: evaluationLine?.confidence ?? baseLine.confidence,
    selectorReason: evaluationLine?.selectorReason ?? baseLine.selectorReason,
    selectionWinner: evaluationLine?.winner ?? baseLine.selectionWinner ?? null,
    startMs: representativeSourceLine.startMs,
    endMs: representativeSourceLine.endMs
  };

  const newLine: AiDraftLine = chooseGuardrailedEvaluatedLine({
    sourceLine: representativeSourceLine,
    selectedLine,
    generatorALine,
    generatorBLine,
    evaluationLine,
    verseState,
    seenChoices: new Map()
  });

  const polishedRepresentativeLines = await applySurfacePolishToDraftLines({
    title: draft.title,
    artist: draft.artist,
    album: draft.album,
    sourceLanguage: draft.sourceLanguage,
    targetLanguage: draft.targetLanguage,
    songContext: draft.songContext,
    worldModel: draft.worldModel,
    artistMemory,
    sourceLines: [representativeSourceLine],
    draftLines: [newLine],
    verseStateLookup,
    worldModelLineLookup
  });
  const finalRepresentativeLine = polishedRepresentativeLines[0] ?? newLine;

  // Apply the result to all matching orders (the target line and its repeated occurrences)
  const updatedLines: AiDraftLine[] = [];

  const updatedDraftLines = draft.lines.map((line) => {
    if (!matchingOrders.includes(line.order)) {
      return line;
    }

    const result: AiDraftLine = {
      ...finalRepresentativeLine,
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

function queueUsageTracking(run: Parameters<typeof recordAiUsageRun>[0]) {
  void recordAiUsageRun(run).catch(() => {
    // Non-fatal analytics side effect.
  });
}

function queuePostGenerationTasks(
  options: Pick<GenerateAiTranslationOptions, "spotifyTrackId" | "title" | "artist">,
  draftFile: AiTranslationDraftFile,
  costSummary: AiCostSummary | undefined,
  startMs: number,
  resultStatus: string
) {
  void recordGenerationLog(options.spotifyTrackId, draftFile, costSummary, startMs, resultStatus);
  void syncDraftIntoLafzBrain(draftFile).catch(() => {
    // Non-fatal Lafz Brain side effect.
  });
  void (async () => {
    const existingGlossary = await getAiGlossaryEntries({
      language: draftFile.sourceLanguage,
      artist: options.artist
    }).catch(() => []);

    await extractAndStoreGlossarySuggestions({
      spotifyTrackId: options.spotifyTrackId,
      title: options.title,
      artist: options.artist,
      sourceLanguage: draftFile.sourceLanguage,
      lines: draftFile.lines.map((line) => ({
        original: line.original,
        chosen: line.chosen,
        meaning: line.meaning
      })),
      existingGlossary
    });
  })().catch(() => {
    // Non-fatal glossary side effect.
  });
}

async function recordGenerationLog(
  spotifyTrackId: string,
  draftFile: AiTranslationDraftFile,
  costSummary: import("@/features/ai/types").AiCostSummary | undefined,
  startMs: number,
  resultStatus: string
): Promise<void> {
  try {
    const { appendGenerationLogEntry } = await import("@/features/ai/generation-log");
    const { readArtistGlossaryFile } = await import("@/features/ai/glossary-repository");
    const now = Date.now();
    const lines = draftFile.lines;

    // Compute which artist glossary terms genuinely matched this song's lyrics
    const artistKey = normalizeArtistKey(draftFile.artist ?? "");
    const glossaryFile = await readArtistGlossaryFile(artistKey).catch(() => null);
    const lyricTexts = lines.map((l) => l.original).filter(Boolean);
    const glossaryTermsMatched = glossaryFile?.entries.length
      ? computeGlossaryHits(glossaryFile.entries, lyricTexts)
      : [];

    // Detect whether an artist profile was active (has real content)
    const artistProfileActive = Boolean(
      draftFile.artistMemory?.personaSummary ||
      (draftFile.artistMemory?.translationDirectives?.length ?? 0) > 0
    );

    await appendGenerationLogEntry(spotifyTrackId, {
      id: `${spotifyTrackId}-${now}-${Math.random().toString(36).slice(2, 8)}`,
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
      glossaryTermsMatched,
      artistProfileActive,
    });
  } catch {
    // Non-fatal
  }
}
