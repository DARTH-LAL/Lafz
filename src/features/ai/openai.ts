import type { AiProviderStatus, GeneratedTranslationLineDraft } from "@/features/ai/types";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

type RequestAiTranslationDraftOptions = {
  title: string;
  artist: string;
  album: string;
  sourceLanguage: string | null;
  targetLanguage: string;
  includeTransliteration: boolean;
  includeNotes: boolean;
  glossaryEntries: Array<{
    term: string;
    meaning: string;
    note?: string;
  }>;
  lines: Array<{
    index: number;
    original: string;
    contextBefore?: string[];
    contextAfter?: string[];
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeOpenAiBaseUrl(value: string | undefined) {
  const trimmedValue = value?.trim() || DEFAULT_OPENAI_BASE_URL;
  return trimmedValue.replace(/\/+$/, "");
}

export function getOpenAiBaseUrl() {
  return normalizeOpenAiBaseUrl(process.env.OPENAI_BASE_URL);
}

export function getOpenAiModel() {
  const value = process.env.OPENAI_MODEL;
  return value && value.trim().length > 0 ? value.trim() : DEFAULT_OPENAI_MODEL;
}

export function isOpenAiConfigured() {
  return typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.trim().length > 0;
}

function buildSchema(lineCount: number) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      detectedSourceLanguage: {
        type: "string"
      },
      lines: {
        type: "array",
        minItems: lineCount,
        maxItems: lineCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            translated: {
              type: "string"
            },
            transliteration: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            note: {
              anyOf: [{ type: "string" }, { type: "null" }]
            }
          },
          required: ["translated", "transliteration", "note"]
        }
      }
    },
    required: ["detectedSourceLanguage", "lines"]
  };
}

function buildSystemPrompt(options: RequestAiTranslationDraftOptions) {
  return [
    "You help draft lyric translations for Lafz, a personal local-first translation tool.",
    options.sourceLanguage
      ? `Translate each lyric line from ${options.sourceLanguage} into ${options.targetLanguage}.`
      : `First infer the lyric language from the provided lines, then translate each line into ${options.targetLanguage}.`,
    "These lyrics may be romanized Punjabi, Hindi, or Urdu written in Latin script, not English.",
    "Preserve the input order exactly. Do not merge, split, reorder, or omit lines.",
    "Keep the translation natural, faithful, and easy to sing or follow.",
    "Do not invent scenes, emotions, or metaphors that are not present in the original line.",
    "If a line is slangy or ambiguous, prefer a conservative literal translation over a poetic rewrite.",
    "Use nearby context only to disambiguate meaning. Do not copy context words into the translation unless they belong to the current line.",
    options.sourceLanguage
      ? `Set detectedSourceLanguage to "${options.sourceLanguage}".`
      : "Set detectedSourceLanguage to the source language you inferred from the lyrics, such as Punjabi, Hindi, Urdu, or another specific language.",
    options.includeTransliteration
      ? "Return transliteration when it adds value. If the original line is already in Latin characters or transliteration would be redundant, return null."
      : "Return null for transliteration on every line.",
    options.includeNotes
      ? "Return a short note only when slang, cultural context, wordplay, or double meaning needs explanation. Otherwise return null."
      : "Return null for note on every line.",
    options.glossaryEntries.length > 0
      ? "Use the provided glossary meanings whenever a matching slang word or phrase appears. Prefer the glossary over guessing."
      : "No glossary is available, so translate conservatively.",
    "Respond only with JSON matching the schema."
  ].join(" ");
}

function buildUserPrompt(options: RequestAiTranslationDraftOptions) {
  return JSON.stringify(
    {
      track: {
        title: options.title,
        artist: options.artist,
        album: options.album
      },
      sourceLanguage: options.sourceLanguage ?? "auto-detect from lyrics",
      targetLanguage: options.targetLanguage,
      outputRules: {
        exactLineCount: options.lines.length,
        includeTransliteration: options.includeTransliteration,
        includeNotes: options.includeNotes
      },
      glossary: options.glossaryEntries,
      lines: options.lines.map((line) => ({
        index: line.index,
        original: line.original,
        contextBefore: line.contextBefore ?? [],
        contextAfter: line.contextAfter ?? []
      }))
    },
    null,
    2
  );
}

function getOpenAiAuthHeaders() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

function normalizeNullableString(value: unknown) {
  return value === null ? null : asString(value);
}

function extractOpenAiErrorMessage(payload: unknown, fallbackMessage: string) {
  if (!isRecord(payload)) {
    return fallbackMessage;
  }

  const error = isRecord(payload.error) ? payload.error : null;
  return asString(error?.message) ?? fallbackMessage;
}

export async function inspectOpenAiStatus(): Promise<AiProviderStatus> {
  const baseUrl = getOpenAiBaseUrl();
  const model = getOpenAiModel();

  if (!isOpenAiConfigured()) {
    return {
      provider: "openai",
      baseUrl,
      model,
      available: false,
      modelAvailable: false,
      installedModels: [],
      errorMessage: "OPENAI_API_KEY is not set in .env.local."
    };
  }

  try {
    const response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}`, {
      headers: getOpenAiAuthHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(4_000)
    });
    const payload = (await response.json().catch(() => null)) as unknown;

    if (response.ok) {
      return {
        provider: "openai",
        baseUrl,
        model,
        available: true,
        modelAvailable: true,
        installedModels: [],
        errorMessage: null
      };
    }

    return {
      provider: "openai",
      baseUrl,
      model,
      available: response.status !== 401,
      modelAvailable: false,
      installedModels: [],
      errorMessage: extractOpenAiErrorMessage(payload, `OpenAI model lookup failed with status ${response.status}.`)
    };
  } catch (error) {
    return {
      provider: "openai",
      baseUrl,
      model,
      available: false,
      modelAvailable: false,
      installedModels: [],
      errorMessage:
        error instanceof Error
          ? `Could not reach OpenAI at ${baseUrl}: ${error.message}`
          : `Could not reach OpenAI at ${baseUrl}.`
    };
  }
}

export async function requestOpenAiTranslationDraft(
  options: RequestAiTranslationDraftOptions
): Promise<{ model: string; sourceLanguage: string; lines: GeneratedTranslationLineDraft[] }> {
  if (options.lines.length === 0) {
    throw new Error("No lyric lines were provided to the AI translation generator.");
  }

  const model = getOpenAiModel();
  const response = await fetch(`${getOpenAiBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: getOpenAiAuthHeaders(),
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: buildSystemPrompt(options)
        },
        {
          role: "user",
          content: buildUserPrompt(options)
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "lafz_translation_draft",
          strict: true,
          schema: buildSchema(options.lines.length)
        }
      }
    })
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(extractOpenAiErrorMessage(payload, `OpenAI request failed with status ${response.status}.`));
  }

  const choices = Array.isArray((payload as { choices?: unknown }).choices)
    ? ((payload as { choices: unknown[] }).choices.filter(isRecord))
    : [];
  const firstChoice = choices[0] ?? null;
  const message = firstChoice && isRecord(firstChoice.message) ? firstChoice.message : null;
  const refusal = asString(message?.refusal);

  if (refusal) {
    throw new Error(`OpenAI refused the translation request: ${refusal}`);
  }

  const outputText = asString(message?.content);

  if (!outputText) {
    throw new Error("OpenAI returned an empty response for the translation draft.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(outputText) as unknown;
  } catch {
    throw new Error("OpenAI returned a draft that was not valid JSON.");
  }

  const detectedSourceLanguage = isRecord(parsed) ? asString(parsed.detectedSourceLanguage) : null;

  if (!isRecord(parsed) || !detectedSourceLanguage || !Array.isArray(parsed.lines) || parsed.lines.length !== options.lines.length) {
    throw new Error("OpenAI returned an invalid draft shape or changed the lyric line count.");
  }

  const lines = parsed.lines.map((line, index) => {
    if (!isRecord(line)) {
      throw new Error(`OpenAI returned a non-object line at index ${index}.`);
    }

    const translated = asString(line.translated);

    if (!translated) {
      throw new Error(`OpenAI returned an empty translated line at index ${index}.`);
    }

    return {
      translated,
      transliteration: normalizeNullableString(line.transliteration),
      note: normalizeNullableString(line.note)
    } satisfies GeneratedTranslationLineDraft;
  });

  return {
    model,
    sourceLanguage: detectedSourceLanguage,
    lines
  };
}
