import { isAnthropicConfigured } from "@/features/ai/anthropic";
import { isGeminiConfigured } from "@/features/ai/gemini";
import { isOpenAiConfigured } from "@/features/ai/openai";

type TranslationPipelineMode = "gemini_only" | "three_model";

function getTranslationPipelineMode(): TranslationPipelineMode {
  const value = process.env.LAFZ_TRANSLATION_PIPELINE_MODE?.trim().toLowerCase();

  if (value === "three_model") {
    return "three_model";
  }

  return "gemini_only";
}

export function isOpenAiGeminiPipelineConfigured() {
  return isOpenAiConfigured() && isGeminiConfigured();
}

export function isLegacyThreeModelTranslationPipelineEnabled() {
  return getTranslationPipelineMode() === "three_model";
}

export function isAiConfigured() {
  if (isLegacyThreeModelTranslationPipelineEnabled()) {
    return isOpenAiConfigured() && isAnthropicConfigured() && isGeminiConfigured();
  }

  return isOpenAiGeminiPipelineConfigured();
}
