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

type RequestAiTranslationRefinementOptions = {
  title: string;
  artist: string;
  album: string;
  sourceLanguage: string;
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
    literal: string;
    natural: string;
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
            literal: {
              type: "string"
            },
            natural: {
              type: "string"
            },
            chosen: {
              type: "string"
            },
            translated: {
              type: "string"
            },
            transliteration: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            note: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            ambiguity: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            confidence: {
              type: "string",
              enum: ["low", "medium", "high"]
            }
          },
          required: ["literal", "natural", "chosen", "translated", "transliteration", "note", "ambiguity", "confidence"]
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
    "For each line, produce: literal, natural, chosen, transliteration, note, ambiguity, and confidence.",
    "Literal must stay very close to the original meaning, even if the English sounds plain.",
    "Natural should sound like clean English while keeping the actual meaning.",
    "Chosen should be the best final line for Lafz to display by default.",
    "Do not invent scenes, emotions, or metaphors that are not present in the original line.",
    "If a line is slangy or ambiguous, prefer a conservative literal translation over a poetic rewrite.",
    "If the meaning is uncertain, keep chosen conservative and explain the uncertainty in ambiguity or note instead of guessing confidently.",
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
    "Set confidence to low, medium, or high based on how certain you are about the line meaning.",
    "Use ambiguity only when the line genuinely has multiple plausible readings or unclear slang. Otherwise return null.",
    options.glossaryEntries.length > 0
      ? "Use the provided glossary meanings whenever a matching slang word or phrase appears. Prefer the glossary over guessing."
      : "No glossary is available, so translate conservatively.",
    "Respond only with JSON matching the schema."
  ].join(" ");
}

function buildRefinementSystemPrompt(options: RequestAiTranslationRefinementOptions) {
  return [
    "You are reviewing a first-pass lyric translation draft for Lafz, a personal local-first translation tool.",
    `The source lyrics are in ${options.sourceLanguage}. Refine them into ${options.targetLanguage}.`,
    "These lyrics may be romanized Punjabi, Hindi, or Urdu written in Latin script.",
    "Preserve the input order exactly. Do not merge, split, reorder, or omit lines.",
    "Review the current literal, natural, and chosen translations for each line and improve them only when needed.",
    "Your main goals are semantic accuracy, slang correctness, and consistency across repeated phrases or recurring terms.",
    "If a repeated original line appears multiple times, keep its chosen translation consistent unless the local context clearly changes the meaning.",
    "Literal should remain close to the original meaning. Natural should sound like clear English. Chosen should be the best conservative final line for display.",
    "Do not invent imagery, emotional emphasis, or cultural detail that is not present in the original lyric.",
    "If the draft is uncertain, keep chosen conservative, lower the confidence, and explain ambiguity instead of guessing.",
    options.includeTransliteration
      ? "Keep transliteration only if it adds value beyond the original line. Otherwise return null."
      : "Return null for transliteration on every line.",
    options.includeNotes
      ? "Keep note short and use it only for slang, context, or double meaning that really needs explanation."
      : "Return null for note on every line.",
    options.glossaryEntries.length > 0
      ? "Use the provided glossary meanings whenever a matching slang term or phrase appears. Prefer the glossary over guessing."
      : "No glossary is available, so refine conservatively.",
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

function buildRefinementUserPrompt(options: RequestAiTranslationRefinementOptions) {
  return JSON.stringify(
    {
      track: {
        title: options.title,
        artist: options.artist,
        album: options.album
      },
      sourceLanguage: options.sourceLanguage,
      targetLanguage: options.targetLanguage,
      outputRules: {
        exactLineCount: options.lines.length,
        includeTransliteration: options.includeTransliteration,
        includeNotes: options.includeNotes,
        preserveOrder: true,
        focus: ["semantic_accuracy", "slang_consistency", "conservative_choice"]
      },
      glossary: options.glossaryEntries,
      lines: options.lines.map((line) => ({
        index: line.index,
        original: line.original,
        currentDraft: {
          literal: line.literal,
          natural: line.natural,
          chosen: line.chosen,
          ambiguity: line.ambiguity,
          confidence: line.confidence
        },
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

function parseGeneratedLines(
  parsed: unknown,
  expectedLineCount: number,
  providerLabel: string
): { sourceLanguage: string; lines: GeneratedTranslationLineDraft[] } {
  const detectedSourceLanguage = isRecord(parsed) ? asString(parsed.detectedSourceLanguage) : null;

  if (!isRecord(parsed) || !detectedSourceLanguage || !Array.isArray(parsed.lines) || parsed.lines.length !== expectedLineCount) {
    throw new Error(`${providerLabel} returned an invalid draft shape or changed the lyric line count.`);
  }

  const lines = parsed.lines.map((line, index) => {
    if (!isRecord(line)) {
      throw new Error(`${providerLabel} returned a non-object line at index ${index}.`);
    }

    const translated = asString(line.translated);
    const literal = asString(line.literal);
    const natural = asString(line.natural);
    const chosen = asString(line.chosen) ?? translated;
    const confidence = line.confidence === "low" || line.confidence === "medium" || line.confidence === "high" ? line.confidence : null;

    if (!translated || !literal || !natural || !chosen || !confidence) {
      throw new Error(`${providerLabel} returned an empty translated line at index ${index}.`);
    }

    return {
      literal,
      natural,
      chosen,
      translated,
      transliteration: normalizeNullableString(line.transliteration),
      note: normalizeNullableString(line.note),
      ambiguity: normalizeNullableString(line.ambiguity),
      confidence
    } satisfies GeneratedTranslationLineDraft;
  });

  return {
    sourceLanguage: detectedSourceLanguage,
    lines
  };
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

  const normalized = parseGeneratedLines(parsed, options.lines.length, "OpenAI");

  return {
    model,
    sourceLanguage: normalized.sourceLanguage,
    lines: normalized.lines
  };
}

export async function requestOpenAiTranslationRefinement(
  options: RequestAiTranslationRefinementOptions
): Promise<{ model: string; sourceLanguage: string; lines: GeneratedTranslationLineDraft[] }> {
  if (options.lines.length === 0) {
    throw new Error("No lyric lines were provided to the AI refinement generator.");
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
          content: buildRefinementSystemPrompt(options)
        },
        {
          role: "user",
          content: buildRefinementUserPrompt(options)
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "lafz_translation_refinement",
          strict: true,
          schema: buildSchema(options.lines.length)
        }
      }
    })
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(extractOpenAiErrorMessage(payload, `OpenAI refinement failed with status ${response.status}.`));
  }

  const choices = Array.isArray((payload as { choices?: unknown }).choices)
    ? (payload as { choices: unknown[] }).choices.filter(isRecord)
    : [];
  const firstChoice = choices[0] ?? null;
  const message = firstChoice && isRecord(firstChoice.message) ? firstChoice.message : null;
  const refusal = asString(message?.refusal);

  if (refusal) {
    throw new Error(`OpenAI refused the refinement request: ${refusal}`);
  }

  const outputText = asString(message?.content);

  if (!outputText) {
    throw new Error("OpenAI returned an empty response for the refinement draft.");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(outputText) as unknown;
  } catch {
    throw new Error("OpenAI returned a refinement draft that was not valid JSON.");
  }

  const normalized = parseGeneratedLines(parsed, options.lines.length, "OpenAI");

  return {
    model,
    sourceLanguage: normalized.sourceLanguage,
    lines: normalized.lines
  };
}
