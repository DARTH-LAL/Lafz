import type { AiGlossaryEntry } from "@/features/ai/glossary";
import { getOllamaModel, inspectOllamaStatus, isOllamaConfigured, requestAiTranslationDraft } from "@/features/ai/ollama";
import { getOpenAiModel, inspectOpenAiStatus, isOpenAiConfigured, requestOpenAiTranslationDraft } from "@/features/ai/openai";
import type { AiProviderStatus, GeneratedTranslationLineDraft } from "@/features/ai/types";

type RequestAiTranslationDraftOptions = {
  title: string;
  artist: string;
  album: string;
  sourceLanguage: string | null;
  targetLanguage: string;
  includeTransliteration: boolean;
  includeNotes: boolean;
  glossaryEntries: AiGlossaryEntry[];
  lines: Array<{
    index: number;
    original: string;
    contextBefore?: string[];
    contextAfter?: string[];
  }>;
};

export function getActiveAiProvider(): AiProviderStatus["provider"] {
  return isOpenAiConfigured() ? "openai" : "ollama";
}

export function getActiveAiModel() {
  return getActiveAiProvider() === "openai" ? getOpenAiModel() : getOllamaModel();
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
