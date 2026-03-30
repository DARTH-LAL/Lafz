import { isAnthropicConfigured } from "@/features/ai/anthropic";
import { isGeminiConfigured } from "@/features/ai/gemini";
import { isOpenAiConfigured } from "@/features/ai/openai";

export function isThreeModelPipelineConfigured() {
  return isOpenAiConfigured() && isAnthropicConfigured() && isGeminiConfigured();
}

export function isAiConfigured() {
  return isThreeModelPipelineConfigured();
}
