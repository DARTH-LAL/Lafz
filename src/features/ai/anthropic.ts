import type { AiGlossaryEntry } from "@/features/ai/glossary";
import {
  buildDraftSchema,
  buildSystemPrompt,
  buildUserPrompt,
  parseGeneratedLines
} from "@/features/ai/openai";
import type {
  AiArtistMemory,
  AiCorrectionHint,
  AiVerseState,
  PreviousTranslationRef,
  GeneratedTranslationLineDraft
} from "@/features/ai/types";

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_ANTHROPIC_GENERATOR_B_MODEL = "claude-sonnet-4-20250514";
const ANTHROPIC_REQUEST_TIMEOUT_MS = 180_000;

type RequestAnthropicTranslationDraftOptions = {
  title: string;
  artist: string;
  album: string;
  sourceLanguage: string | null;
  targetLanguage: string;
  includeTransliteration: boolean;
  includeNotes: boolean;
  glossaryEntries: AiGlossaryEntry[];
  songContext: {
    summary: string;
    themes: string[];
    tone: string;
    notablePhrases: string[];
    speaker: string | null;
    addressee: string | null;
    stance: string | null;
    narrativeMode: string | null;
  } | null;
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

function normalizeAnthropicBaseUrl(value: string | undefined) {
  const trimmedValue = value?.trim() || DEFAULT_ANTHROPIC_BASE_URL;
  return trimmedValue.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function extractAnthropicErrorMessage(payload: unknown, fallbackMessage: string) {
  if (!isRecord(payload)) {
    return fallbackMessage;
  }

  const error = isRecord(payload.error) ? payload.error : null;
  return asString(error?.message) ?? fallbackMessage;
}

function extractAnthropicText(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.content)) {
    return null;
  }

  const parts = payload.content.filter(isRecord);
  const text = parts
    .map((part) => (part.type === "text" ? asString(part.text) : null))
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .trim();

  return text.length > 0 ? text : null;
}

function extractJsonCandidate(text: string) {
  const trimmed = text.trim();
  const candidates = new Set<string>();

  if (trimmed.length > 0) {
    candidates.add(trimmed);
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]?.trim()) {
    candidates.add(fencedMatch[1].trim());
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.add(trimmed.slice(objectStart, objectEnd + 1).trim());
  }

  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.add(trimmed.slice(arrayStart, arrayEnd + 1).trim());
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }

  return null;
}

function getAnthropicAuthHeaders() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  return {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json"
  };
}

export function getAnthropicBaseUrl() {
  return normalizeAnthropicBaseUrl(process.env.ANTHROPIC_BASE_URL);
}

export function getAnthropicGeneratorBModel() {
  const value = process.env.ANTHROPIC_GENERATOR_B_MODEL?.trim();
  if (value && value.length > 0) return value;
  try {
    const { readSettingsSync } = require("@/features/settings/repository") as { readSettingsSync: () => { generatorBModel: string } };
    const model = readSettingsSync().generatorBModel;
    if (model) return model;
  } catch {}
  return DEFAULT_ANTHROPIC_GENERATOR_B_MODEL;
}

export async function resolveAnthropicGeneratorBModel() {
  const value = process.env.ANTHROPIC_GENERATOR_B_MODEL?.trim();
  if (value && value.length > 0) return value;

  const { readSettings } = (await import("@/features/settings/repository")) as {
    readSettings: () => Promise<{ generatorBModel: string }>;
  };
  const model = (await readSettings()).generatorBModel;
  return model || DEFAULT_ANTHROPIC_GENERATOR_B_MODEL;
}

export function isAnthropicConfigured() {
  return typeof process.env.ANTHROPIC_API_KEY === "string" && process.env.ANTHROPIC_API_KEY.trim().length > 0;
}

async function callAnthropicJson<T>(options: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  errorLabel: string;
  usageSink?: { inputTokens: number; outputTokens: number };
}): Promise<T> {
  const response = await fetch(`${getAnthropicBaseUrl()}/messages`, {
    method: "POST",
    headers: getAnthropicAuthHeaders(),
    signal: AbortSignal.timeout(ANTHROPIC_REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: options.model,
      max_tokens: 8_000,
      system: options.systemPrompt,
      messages: [
        {
          role: "user",
          content: options.userPrompt
        },
        {
          role: "assistant",
          content: "{"
        }
      ]
    })
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(extractAnthropicErrorMessage(payload, `${options.errorLabel} failed with status ${response.status}.`));
  }

  if (options.usageSink && isRecord(payload) && isRecord(payload.usage)) {
    const usage = payload.usage;
    if (typeof usage.input_tokens === "number") options.usageSink.inputTokens += usage.input_tokens;
    if (typeof usage.output_tokens === "number") options.usageSink.outputTokens += usage.output_tokens;
  }

  const rawText = extractAnthropicText(payload);

  if (!rawText) {
    throw new Error(`Anthropic returned an empty response for ${options.errorLabel.toLowerCase()}.`);
  }

  const outputText = "{" + rawText;
  const parsed = extractJsonCandidate(outputText);

  if (parsed === null) {
    throw new Error(`Anthropic returned JSON that could not be parsed for ${options.errorLabel.toLowerCase()}.`);
  }

  return parsed as T;
}

function buildAnthropicSystemPrompt(options: RequestAnthropicTranslationDraftOptions) {
  const lineCount = options.lines.length;
  const schema = JSON.stringify(buildDraftSchema(lineCount), null, 2);
  return buildSystemPrompt(options).replace(
    "Respond only with JSON matching the schema.",
    `Respond only with a JSON object matching this exact schema (exactly ${lineCount} lines):\n${schema}`
  );
}

export async function requestAnthropicTranslationDraft(
  options: RequestAnthropicTranslationDraftOptions,
  usageSink?: { inputTokens: number; outputTokens: number }
): Promise<{ model: string; sourceLanguage: string; lines: GeneratedTranslationLineDraft[]; usage: { inputTokens: number; outputTokens: number } }> {
  if (options.lines.length === 0) {
    throw new Error("No lyric lines were provided to Anthropic Generator B.");
  }

  const localSink = { inputTokens: 0, outputTokens: 0 };
  const model = await resolveAnthropicGeneratorBModel();
  const parsed = await callAnthropicJson<unknown>({
    model,
    systemPrompt: buildAnthropicSystemPrompt(options),
    userPrompt: buildUserPrompt(options),
    errorLabel: "Anthropic translation request",
    usageSink: localSink
  });
  const normalized = parseGeneratedLines(parsed, options.lines.length, "Anthropic");

  if (usageSink) {
    usageSink.inputTokens += localSink.inputTokens;
    usageSink.outputTokens += localSink.outputTokens;
  }

  return {
    model,
    sourceLanguage: normalized.sourceLanguage,
    lines: normalized.lines,
    usage: localSink
  };
}
