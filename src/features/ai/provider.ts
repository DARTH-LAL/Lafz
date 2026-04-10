import { isGeminiConfigured } from "@/features/ai/gemini";
import { isOpenAiConfigured } from "@/features/ai/openai";

export function isOpenAiGeminiPipelineConfigured() {
  return isOpenAiConfigured() && isGeminiConfigured();
}

export function isLegacyThreeModelTranslationPipelineEnabled() {
  return false;
}

export function isAiConfigured() {
  return isOpenAiGeminiPipelineConfigured();
}
