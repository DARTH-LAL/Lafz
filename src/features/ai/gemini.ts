import type { AiGlossaryEntry } from "@/features/ai/glossary";
import type {
  AiArtistMemory,
  AiCorrectionHint,
  AiSongContext
} from "@/features/ai/types";

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_EVALUATOR_MODEL = "gemini-2.5-pro";
const GEMINI_REQUEST_TIMEOUT_MS = 180_000;

type GeminiDraftComparisonLine = {
  index: number;
  original: string;
  normalizedOriginal?: string | null;
  meaning: string;
  impliedMeaning: string | null;
  register: string | null;
  generatorA: {
    literal: string;
    natural: string;
    slangAware: string;
    chosen: string;
    transliteration: string | null;
    note: string | null;
    ambiguity: string | null;
    confidence: "low" | "medium" | "high";
  };
  generatorB: {
    literal: string;
    natural: string;
    slangAware: string;
    chosen: string;
    transliteration: string | null;
    note: string | null;
    ambiguity: string | null;
    confidence: "low" | "medium" | "high";
  };
  contextBefore?: Array<{
    original: string;
    chosen: string;
  }>;
  contextAfter?: Array<{
    original: string;
    chosen: string;
  }>;
  matchingCorrections?: AiCorrectionHint[];
};

type RequestGeminiDraftComparisonOptions = {
  title: string;
  artist: string;
  album: string;
  sourceLanguage: string;
  targetLanguage: string;
  glossaryEntries: AiGlossaryEntry[];
  songContext: AiSongContext | null;
  artistMemory: AiArtistMemory | null;
  lines: GeminiDraftComparisonLine[];
};

function normalizeGeminiBaseUrl(value: string | undefined) {
  const trimmedValue = value?.trim() || DEFAULT_GEMINI_BASE_URL;
  return trimmedValue.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeNullableString(value: unknown) {
  return value === null ? null : asString(value);
}

function extractGeminiErrorMessage(payload: unknown, fallbackMessage: string) {
  if (!isRecord(payload)) {
    return fallbackMessage;
  }

  const error = isRecord(payload.error) ? payload.error : null;
  return asString(error?.message) ?? fallbackMessage;
}

function getGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  return apiKey;
}

function getGeminiResponseText(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
    return null;
  }

  for (const candidate of payload.candidates.filter(isRecord)) {
    const content = isRecord(candidate.content) ? candidate.content : null;
    const parts = Array.isArray(content?.parts) ? content.parts.filter(isRecord) : [];

    for (const part of parts) {
      const text = asString(part.text);
      if (text) {
        return text;
      }
    }
  }

  return null;
}

function buildGeminiComparisonSystemPrompt(options: RequestGeminiDraftComparisonOptions) {
  const sharedHints: string[] = [
    "You are the final evaluator for Lafz lyric translations.",
    `The source lyrics are in ${options.sourceLanguage}. Evaluate two translation candidates for each line and produce the best final English line.`,
    "Prioritize semantic accuracy first, then slang/cultural correctness, then lyrical naturalness.",
    "Do not reward flashier wording if it drifts away from the original meaning.",
    "You may choose Generator A, choose Generator B, or synthesize a blended line only if the blend stays grounded in the original lyric.",
    "Use song context, glossary hints, artist memory, nearby lines, and manual correction hints to stay consistent.",
    "If both candidates are weak, choose the more conservative option or synthesize a conservative correction.",
    "Return only JSON with detectedSourceLanguage and lines. Each line must include winner, chosen, confidence, ambiguity, note, and selectorReason.",
    "winner must be one of: generator_a, generator_b, blended."
  ];

  if (options.artistMemory) {
    sharedHints.push(
      `Artist memory for ${options.artistMemory.displayName}: translationPreferences=${options.artistMemory.translationPreferences.join(" | ") || "none"}; recurringThemes=${options.artistMemory.recurringThemes.join(" | ") || "none"}; toneNotes=${options.artistMemory.toneNotes.join(" | ") || "none"}; notes=${options.artistMemory.notes.join(" | ") || "none"}.`
    );
  }

  if (options.glossaryEntries.length > 0) {
    sharedHints.push("Use the glossary whenever a matching slang word, idiom, phrase, or reference appears.");
  }

  return sharedHints.join(" ");
}

function buildGeminiComparisonUserPrompt(options: RequestGeminiDraftComparisonOptions) {
  return JSON.stringify(
    {
      track: {
        title: options.title,
        artist: options.artist,
        album: options.album
      },
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage,
      songContext: options.songContext,
      artistMemory: options.artistMemory,
      glossary: options.glossaryEntries,
      lines: options.lines
    },
    null,
    2
  );
}

export function getGeminiBaseUrl() {
  return normalizeGeminiBaseUrl(process.env.GEMINI_BASE_URL);
}

export function getGeminiEvaluatorModel() {
  const value = process.env.GEMINI_EVALUATOR_MODEL?.trim();
  return value && value.length > 0 ? value : DEFAULT_GEMINI_EVALUATOR_MODEL;
}

export function isGeminiConfigured() {
  return typeof process.env.GEMINI_API_KEY === "string" && process.env.GEMINI_API_KEY.trim().length > 0;
}

async function callGeminiJson<T>(options: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  errorLabel: string;
  usageSink?: { inputTokens: number; outputTokens: number };
}): Promise<T> {
  const response = await fetch(
    `${getGeminiBaseUrl()}/models/${encodeURIComponent(options.model)}:generateContent?key=${encodeURIComponent(getGeminiApiKey())}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      signal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        systemInstruction: {
          role: "system",
          parts: [{ text: options.systemPrompt }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: options.userPrompt }]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      })
    }
  );

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(extractGeminiErrorMessage(payload, `${options.errorLabel} failed with status ${response.status}.`));
  }

  if (options.usageSink && isRecord(payload) && isRecord(payload.usageMetadata)) {
    const meta = payload.usageMetadata;
    if (typeof meta.promptTokenCount === "number") options.usageSink.inputTokens += meta.promptTokenCount;
    if (typeof meta.candidatesTokenCount === "number") options.usageSink.outputTokens += meta.candidatesTokenCount;
  }

  const outputText = getGeminiResponseText(payload);

  if (!outputText) {
    throw new Error(`Gemini returned an empty response for ${options.errorLabel.toLowerCase()}.`);
  }

  try {
    return JSON.parse(outputText) as T;
  } catch {
    throw new Error(`Gemini returned JSON that could not be parsed for ${options.errorLabel.toLowerCase()}.`);
  }
}

export async function requestGeminiDraftComparison(
  options: RequestGeminiDraftComparisonOptions,
  usageSink?: { inputTokens: number; outputTokens: number }
): Promise<{
  model: string;
  sourceLanguage: string;
  lines: Array<{
    winner: "generator_a" | "generator_b" | "blended";
    chosen: string;
    confidence: "low" | "medium" | "high";
    ambiguity: string | null;
    note: string | null;
    selectorReason: string | null;
  }>;
  usage: { inputTokens: number; outputTokens: number };
}> {
  if (options.lines.length === 0) {
    throw new Error("No lyric lines were provided to the Gemini evaluator.");
  }

  const localSink = { inputTokens: 0, outputTokens: 0 };
  const model = getGeminiEvaluatorModel();
  const parsed = await callGeminiJson<unknown>({
    model,
    systemPrompt: buildGeminiComparisonSystemPrompt(options),
    userPrompt: buildGeminiComparisonUserPrompt(options),
    errorLabel: "Gemini evaluator request",
    usageSink: localSink
  });

  const detectedSourceLanguage = isRecord(parsed) ? asString(parsed.detectedSourceLanguage) : null;

  if (!isRecord(parsed) || !detectedSourceLanguage || !Array.isArray(parsed.lines) || parsed.lines.length !== options.lines.length) {
    throw new Error("Gemini returned an invalid comparison shape or changed the lyric line count.");
  }

  if (usageSink) {
    usageSink.inputTokens += localSink.inputTokens;
    usageSink.outputTokens += localSink.outputTokens;
  }

  return {
    model,
    sourceLanguage: detectedSourceLanguage,
    lines: parsed.lines.map((line, index) => {
      if (!isRecord(line)) {
        throw new Error(`Gemini returned a non-object comparison line at index ${index}.`);
      }

      const winner =
        line.winner === "generator_a" || line.winner === "generator_b" || line.winner === "blended" ? line.winner : null;
      const chosen = asString(line.chosen);
      const confidence = line.confidence === "low" || line.confidence === "medium" || line.confidence === "high" ? line.confidence : null;

      if (!winner || !chosen || !confidence) {
        throw new Error(`Gemini returned an invalid comparison line at index ${index}.`);
      }

      return {
        winner,
        chosen,
        confidence,
        ambiguity: normalizeNullableString(line.ambiguity),
        note: normalizeNullableString(line.note),
        selectorReason: normalizeNullableString(line.selectorReason)
      };
    }),
    usage: localSink
  };
}
