import type { AiGlossaryEntry } from "@/features/ai/glossary";
import type {
  AiArtistMemory,
  AiCorrectionHint,
  AiProviderStatus,
  AiSongContext,
  AiVerseState,
  GeneratedTranslationLineDraft,
  MeaningAnalysisLine
} from "@/features/ai/types";
import {
  getOllamaModel,
  inspectOllamaStatus,
  isOllamaConfigured,
  requestAiSongContext,
  requestAiMeaningAnalysis,
  requestAiTranslationSelection,
  requestAiTranslationDraft,
  requestAiTranslationRefinement
} from "@/features/ai/ollama";
import {
  getOpenAiModel,
  resolveOpenAiModel,
  inspectOpenAiStatus,
  isOpenAiConfigured,
  requestOpenAiSongContext,
  requestOpenAiMeaningAnalysis,
  requestOpenAiTranslationSelection,
  requestOpenAiTranslationDraft,
  requestOpenAiTranslationRefinement
} from "@/features/ai/openai";
import { getAnthropicGeneratorBModel, isAnthropicConfigured, resolveAnthropicGeneratorBModel } from "@/features/ai/anthropic";
import { getGeminiEvaluatorModel, isGeminiConfigured, resolveGeminiEvaluatorModel } from "@/features/ai/gemini";
export type PreviousTranslationRef = {
  chosen: string;
  confidence: "low" | "medium" | "high";
  manuallyReviewed: boolean;
};

type RequestAiTranslationDraftOptions = {
  title: string;
  artist: string;
  album: string;
  sourceLanguage: string | null;
  targetLanguage: string;
  includeTransliteration: boolean;
  includeNotes: boolean;
  glossaryEntries: AiGlossaryEntry[];
  songContext: AiSongContext | null;
  artistMemory: AiArtistMemory | null;
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
    matchingCorrections?: AiCorrectionHint[];
    previousTranslation?: PreviousTranslationRef | null;
  }>;
};

type RequestAiMeaningAnalysisOptions = {
  title: string;
  artist: string;
  album: string;
  sourceLanguage: string | null;
  glossaryEntries: AiGlossaryEntry[];
  songContext: AiSongContext | null;
  artistMemory: AiArtistMemory | null;
  lines: Array<{
    index: number;
    original: string;
    normalizedOriginal?: string | null;
    normalizationNotes?: string[];
    contextBefore?: string[];
    contextAfter?: string[];
    groupIndex?: number;
    groupText?: string;
    verseState?: AiVerseState | null;
    matchingCorrections?: AiCorrectionHint[];
  }>;
};

type RequestAiTranslationRefinementOptions = {
  title: string;
  artist: string;
  album: string;
  sourceLanguage: string;
  targetLanguage: string;
  includeTransliteration: boolean;
  includeNotes: boolean;
  glossaryEntries: AiGlossaryEntry[];
  songContext: AiSongContext | null;
  artistMemory: AiArtistMemory | null;
  lines: Array<{
    index: number;
    original: string;
    normalizedOriginal?: string | null;
    meaning: string;
    impliedMeaning: string | null;
    register: string | null;
    literal: string;
    natural: string;
    slangAware: string;
    chosen: string;
    ambiguity: string | null;
    confidence: "low" | "medium" | "high";
    contextBefore?: Array<{
      original: string;
      chosen: string;
    }>;
    contextAfter?: Array<{
      original: string;
      chosen: string;
    }>;
    verseState?: AiVerseState | null;
    matchingCorrections?: AiCorrectionHint[];
    previousTranslation?: PreviousTranslationRef | null;
  }>;
};

type RequestAiSongContextOptions = {
  title: string;
  artist: string;
  album: string;
  sourceLanguage: string | null;
  glossaryEntries: AiGlossaryEntry[];
  artistMemory: AiArtistMemory | null;
  lines: Array<{
    index: number;
    original: string;
  }>;
};

type RequestAiTranslationSelectionOptions = {
  title: string;
  artist: string;
  album: string;
  sourceLanguage: string;
  targetLanguage: string;
  includeTransliteration: boolean;
  includeNotes: boolean;
  glossaryEntries: AiGlossaryEntry[];
  songContext: AiSongContext | null;
  artistMemory: AiArtistMemory | null;
  lines: Array<{
    index: number;
    original: string;
    normalizedOriginal?: string | null;
    meaning: string;
    impliedMeaning: string | null;
    register: string | null;
    literal: string;
    natural: string;
    slangAware: string;
    currentChosen: string;
    note: string | null;
    ambiguity: string | null;
    confidence: "low" | "medium" | "high";
    contextBefore?: Array<{
      original: string;
      chosen: string;
    }>;
    contextAfter?: Array<{
      original: string;
      chosen: string;
    }>;
    verseState?: AiVerseState | null;
    matchingCorrections?: AiCorrectionHint[];
    previousTranslation?: PreviousTranslationRef | null;
  }>;
};

export function getActiveAiProvider(): AiProviderStatus["provider"] {
  return isOpenAiConfigured() ? "openai" : "ollama";
}

export function isThreeModelPipelineConfigured() {
  return isOpenAiConfigured() && isAnthropicConfigured() && isGeminiConfigured();
}

export function getThreeModelPipelineLabel() {
  return `A:${getOpenAiModel()} | B:${getAnthropicGeneratorBModel()} | Eval:${getGeminiEvaluatorModel()}`;
}

export async function getThreeModelPipelineLabelAsync() {
  const [generatorA, generatorB, evaluator] = await Promise.all([
    resolveOpenAiModel(),
    resolveAnthropicGeneratorBModel(),
    resolveGeminiEvaluatorModel()
  ]);
  return `A:${generatorA} | B:${generatorB} | Eval:${evaluator}`;
}

export function getActiveAiModel() {
  return getActiveAiProvider() === "openai" ? getOpenAiModel() : getOllamaModel();
}

export async function getActiveAiModelAsync() {
  return getActiveAiProvider() === "openai" ? resolveOpenAiModel() : getOllamaModel();
}

export function isAiConfigured() {
  return getActiveAiProvider() === "openai" ? isOpenAiConfigured() : isOllamaConfigured();
}

export async function inspectAiProviderStatus(): Promise<AiProviderStatus> {
  return getActiveAiProvider() === "openai" ? inspectOpenAiStatus() : inspectOllamaStatus();
}

export async function requestProviderTranslationDraft(
  options: RequestAiTranslationDraftOptions
): Promise<{ model: string; sourceLanguage: string; lines: GeneratedTranslationLineDraft[] }> {
  return getActiveAiProvider() === "openai" ? requestOpenAiTranslationDraft(options) : requestAiTranslationDraft(options);
}

export async function requestProviderMeaningAnalysis(
  options: RequestAiMeaningAnalysisOptions
): Promise<{ model: string; sourceLanguage: string; lines: MeaningAnalysisLine[] }> {
  return getActiveAiProvider() === "openai" ? requestOpenAiMeaningAnalysis(options) : requestAiMeaningAnalysis(options);
}

export async function requestProviderTranslationRefinement(
  options: RequestAiTranslationRefinementOptions
): Promise<{ model: string; sourceLanguage: string; lines: GeneratedTranslationLineDraft[] }> {
  return getActiveAiProvider() === "openai"
    ? requestOpenAiTranslationRefinement(options)
    : requestAiTranslationRefinement(options);
}

export async function requestProviderSongContext(
  options: RequestAiSongContextOptions
): Promise<{ model: string; sourceLanguage: string; songContext: AiSongContext }> {
  return getActiveAiProvider() === "openai" ? requestOpenAiSongContext(options) : requestAiSongContext(options);
}

export async function requestProviderTranslationSelection(
  options: RequestAiTranslationSelectionOptions
): Promise<{
  model: string;
  sourceLanguage: string;
  lines: Array<{
    chosen: string;
    confidence: "low" | "medium" | "high";
    ambiguity: string | null;
    note: string | null;
    selectorReason: string | null;
  }>;
}> {
  return getActiveAiProvider() === "openai"
    ? requestOpenAiTranslationSelection(options)
    : requestAiTranslationSelection(options);
}
