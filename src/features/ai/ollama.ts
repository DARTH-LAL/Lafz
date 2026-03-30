import type { AiGlossaryEntry } from "@/features/ai/glossary";
import { buildArtistMemoryPromptSnippet, serializeArtistMemoryForPrompt } from "@/features/ai/artist-profile-format";
import type {
  AiArtistMemory,
  AiCorrectionHint,
  AiProviderStatus,
  AiSongContext,
  AiVerseState,
  GeneratedTranslationLineDraft,
  MeaningAnalysisLine
} from "@/features/ai/types";

const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "qwen2.5:14b";
const OLLAMA_REQUEST_TIMEOUT_MS = 90_000;

type BasePromptOptions = {
  title: string;
  artist: string;
  album: string;
  glossaryEntries: AiGlossaryEntry[];
  artistMemory: AiArtistMemory | null;
};

type RequestAiTranslationDraftOptions = BasePromptOptions & {
  sourceLanguage: string | null;
  targetLanguage: string;
  includeTransliteration: boolean;
  includeNotes: boolean;
  songContext: AiSongContext | null;
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
  }>;
};

type RequestAiMeaningAnalysisOptions = BasePromptOptions & {
  sourceLanguage: string | null;
  songContext: AiSongContext | null;
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

type RequestAiTranslationRefinementOptions = BasePromptOptions & {
  sourceLanguage: string;
  targetLanguage: string;
  includeTransliteration: boolean;
  includeNotes: boolean;
  songContext: AiSongContext | null;
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
  }>;
};

type RequestAiSongContextOptions = BasePromptOptions & {
  sourceLanguage: string | null;
  lines: Array<{
    index: number;
    original: string;
  }>;
};

type RequestAiTranslationSelectionOptions = BasePromptOptions & {
  sourceLanguage: string;
  targetLanguage: string;
  includeTransliteration: boolean;
  includeNotes: boolean;
  songContext: AiSongContext | null;
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
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeOllamaBaseUrl(value: string | undefined) {
  const trimmedValue = value?.trim() || DEFAULT_OLLAMA_BASE_URL;
  const withoutTrailingSlash = trimmedValue.replace(/\/+$/, "");
  return withoutTrailingSlash.endsWith("/api") ? withoutTrailingSlash.slice(0, -4) : withoutTrailingSlash;
}

function getOllamaApiBaseUrl() {
  return `${normalizeOllamaBaseUrl(process.env.OLLAMA_BASE_URL)}/api`;
}

export function getOllamaBaseUrl() {
  return normalizeOllamaBaseUrl(process.env.OLLAMA_BASE_URL);
}

export function getOllamaModel() {
  const value = process.env.OLLAMA_MODEL;
  return value && value.trim().length > 0 ? value.trim() : DEFAULT_OLLAMA_MODEL;
}

export function isOllamaConfigured() {
  return true;
}

function buildDraftSchema(lineCount: number) {
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
            literal: { type: "string" },
            meaning: { type: "string" },
            impliedMeaning: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            register: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            natural: { type: "string" },
            slangAware: { type: "string" },
            chosen: { type: "string" },
            translated: { type: "string" },
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
            },
            selectorReason: {
              anyOf: [{ type: "string" }, { type: "null" }]
            }
          },
          required: [
            "literal",
            "meaning",
            "impliedMeaning",
            "register",
            "natural",
            "slangAware",
            "chosen",
            "translated",
            "transliteration",
            "note",
            "ambiguity",
            "confidence",
            "selectorReason"
          ]
        }
      }
    },
    required: ["detectedSourceLanguage", "lines"]
  };
}

function buildMeaningSchema(lineCount: number) {
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
            meaning: { type: "string" },
            impliedMeaning: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            register: {
              anyOf: [{ type: "string" }, { type: "null" }]
            }
          },
          required: ["meaning", "impliedMeaning", "register"]
        }
      }
    },
    required: ["detectedSourceLanguage", "lines"]
  };
}

function buildSongContextSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      detectedSourceLanguage: { type: "string" },
      summary: { type: "string" },
      speaker: {
        anyOf: [{ type: "string" }, { type: "null" }]
      },
      addressee: {
        anyOf: [{ type: "string" }, { type: "null" }]
      },
      stance: {
        anyOf: [{ type: "string" }, { type: "null" }]
      },
      narrativeMode: {
        anyOf: [{ type: "string" }, { type: "null" }]
      },
      themes: {
        type: "array",
        items: { type: "string" }
      },
      tone: { type: "string" },
      notablePhrases: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: ["detectedSourceLanguage", "summary", "speaker", "addressee", "stance", "narrativeMode", "themes", "tone", "notablePhrases"]
  };
}

function buildSelectionSchema(lineCount: number) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      detectedSourceLanguage: { type: "string" },
      lines: {
        type: "array",
        minItems: lineCount,
        maxItems: lineCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            chosen: { type: "string" },
            confidence: {
              type: "string",
              enum: ["low", "medium", "high"]
            },
            ambiguity: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            note: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            selectorReason: {
              anyOf: [{ type: "string" }, { type: "null" }]
            }
          },
          required: ["chosen", "confidence", "ambiguity", "note", "selectorReason"]
        }
      }
    },
    required: ["detectedSourceLanguage", "lines"]
  };
}

function buildSharedContextHints(options: BasePromptOptions, sourceLanguage: string | null) {
  const hints: string[] = [];

  if (sourceLanguage) {
    hints.push(`Treat the source language as ${sourceLanguage}.`);
  } else {
    hints.push("Infer the source language from the lyrics before translating them.");
  }

  if (options.artistMemory) {
    const artistMemoryHint = buildArtistMemoryPromptSnippet(options.artistMemory);
    if (artistMemoryHint) {
      hints.push(artistMemoryHint);
      hints.push(
        "Preserve the artist's perspective and relationship posture instead of flattening the voice into generic English."
      );
    }
  }

  if (options.glossaryEntries.length > 0) {
    hints.push("Use the provided glossary meanings whenever a matching slang word, idiom, phrase, or reference appears.");
  }

  return hints.join(" ");
}

function buildSystemPrompt(options: RequestAiTranslationDraftOptions) {
  return [
    "You help draft lyric translations for Lafz, a personal local-first translation tool.",
    options.sourceLanguage
      ? `Translate each lyric line from ${options.sourceLanguage} into ${options.targetLanguage}.`
      : `First infer the lyric language from the provided lines, then translate each line into ${options.targetLanguage}.`,
    "These lyrics may be romanized Punjabi, Hindi, or Urdu written in Latin script, not English.",
    "Preserve the input order exactly. Do not merge, split, reorder, or omit lines.",
    "For each line, produce meaning, impliedMeaning, register, literal, natural, slangAware, chosen, transliteration, note, ambiguity, confidence, and selectorReason.",
    "Treat meaning as a concise semantic gloss of what the line is saying before polishing it into display English.",
    "Treat impliedMeaning as optional cultural/subtextual explanation when the line hints at swagger, warning, romance, or disrespect beyond the literal meaning.",
    "Treat register as a short label like flex, romantic, warning, teasing, devotional, boastful, reflective, or null if not useful.",
    "Literal must stay very close to the original meaning, even if the English sounds plain.",
    "Natural should sound like clean English while keeping the actual meaning.",
    "SlangAware should preserve swagger, idiom, and lyrical tone without inventing new meaning.",
    "Chosen should be the strongest conservative final line for display.",
    "Do not invent scenes, emotions, or metaphors that are not present in the original line.",
    "Use nearby context, verse group context, song context, artist memory, and glossary hints to disambiguate meaning.",
    "If verseState is provided for a line, treat it as a strong local-context signal for stance, target, and what the surrounding block is doing.",
    "If a line includes correction examples, treat them as strong guidance for similar phrasing unless the current context clearly changes the meaning.",
    "If the meaning is uncertain, keep chosen conservative and explain uncertainty in ambiguity or note instead of guessing confidently.",
    options.includeTransliteration
      ? "Return transliteration only when it adds value. If the original line is already in Latin characters or transliteration would be redundant, return null."
      : "Return null for transliteration on every line.",
    options.includeNotes
      ? "Return a short note only when slang, cultural context, wordplay, or double meaning needs explanation. Otherwise return null."
      : "Return null for note on every line.",
    "Set confidence to low, medium, or high based on how certain you are about the line meaning.",
    "Set selectorReason to a short phrase explaining why chosen is the best candidate, or null if unnecessary.",
    buildSharedContextHints(options, options.sourceLanguage),
    "Respond only with JSON matching the schema."
  ].join(" ");
}

function buildMeaningSystemPrompt(options: RequestAiMeaningAnalysisOptions) {
  return [
    "You are the meaning-analysis pass for Lafz lyric translation.",
    options.sourceLanguage
      ? `Interpret each lyric line from ${options.sourceLanguage} before any final English rewriting.`
      : "First infer the lyric language from the provided lines, then interpret each line before any final English rewriting.",
    "These lyrics may be romanized Punjabi, Hindi, or Urdu written in Latin script.",
    "Preserve the input order exactly. Do not merge, split, reorder, or omit lines.",
    "For each line, produce a concise meaning, an optional impliedMeaning, and an optional register label.",
    "Meaning should explain what the line actually says in plain English without turning it into polished lyrics.",
    "ImpliedMeaning should only be used when slang, posture, threat, romance, or cultural context adds an important second layer.",
    "Do not over-interpret. If context is ambiguous, keep meaning conservative and set impliedMeaning to null.",
    "Use nearby context, verse-group context, song context, artist memory, glossary hints, and correction examples to resolve slang and idioms.",
    buildSharedContextHints(options, options.sourceLanguage),
    "Respond only with JSON matching the schema."
  ].join(" ");
}

function buildRefinementSystemPrompt(options: RequestAiTranslationRefinementOptions) {
  return [
    "You are reviewing a first-pass lyric translation draft for Lafz, a personal local-first translation tool.",
    `The source lyrics are in ${options.sourceLanguage}. Refine them into ${options.targetLanguage}.`,
    "These lyrics may be romanized Punjabi, Hindi, or Urdu written in Latin script.",
    "Preserve the input order exactly. Do not merge, split, reorder, or omit lines.",
    "Review the current literal, natural, slangAware, and chosen translations for each line and improve them only when needed.",
    "Your main goals are semantic accuracy, slang correctness, and consistency across repeated phrases or recurring terms.",
    "If a repeated original line appears multiple times, keep its translation candidates consistent unless the local context clearly changes the meaning.",
    "If verseState is provided, preserve that local block's stance, target, and emotional logic while refining.",
    "If manual correction examples are provided for a line, preserve their corrected meaning and style for similar phrasing unless the current context clearly changes it.",
    "Do not invent imagery, emotional emphasis, or cultural detail that is not present in the original lyric.",
    "If the draft is uncertain, keep chosen conservative, lower the confidence, and explain ambiguity instead of guessing.",
    options.includeTransliteration
      ? "Keep transliteration only if it adds value beyond the original line. Otherwise return null."
      : "Return null for transliteration on every line.",
    options.includeNotes
      ? "Keep note short and use it only for slang, context, or double meaning that really needs explanation."
      : "Return null for note on every line.",
    "SelectorReason should briefly explain why the chosen line is preferable among the candidates.",
    buildSharedContextHints(options, options.sourceLanguage),
    "Respond only with JSON matching the schema."
  ].join(" ");
}

function buildSongContextSystemPrompt(options: RequestAiSongContextOptions) {
  return [
    "You are summarizing song context for Lafz before translation.",
    "These lyrics may be romanized Punjabi, Hindi, or Urdu written in Latin script.",
    "Infer the most likely song-level themes, attitude, recurring ideas, speaker, addressee, stance, and narrative mode without overclaiming.",
    "Keep the summary concise and grounded in the provided lines.",
    buildSharedContextHints(options, options.sourceLanguage),
    "Respond only with JSON matching the schema."
  ].join(" ");
}

function buildSelectionSystemPrompt(options: RequestAiTranslationSelectionOptions) {
  return [
    "You are the final selector for Lafz lyric translations.",
    `The source lyrics are in ${options.sourceLanguage}. Select the best final English line for each entry.`,
    "Choose among the candidate translations by prioritizing semantic accuracy first, then slang correctness, then lyrical naturalness.",
    "Use song context, artist memory, glossary hints, and nearby chosen lines to keep the whole song consistent.",
    "If verseState is provided, use it to preserve local block intent and to avoid selecting a line that sounds good but belongs to a different moment in the song.",
    "If manual correction examples are provided for a line, treat them as strong guidance and stay aligned with their corrected meaning unless the current context clearly changes it.",
    "Do not rewrite the original meaning into something flashier than the lyric actually says.",
    "If the candidates are all weak, choose the most conservative one, reduce confidence, and explain ambiguity or note instead of guessing.",
    buildSharedContextHints(options, options.sourceLanguage),
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
      songContext: options.songContext,
      artistMemory: serializeArtistMemoryForPrompt(options.artistMemory),
      outputRules: {
        exactLineCount: options.lines.length,
        includeTransliteration: options.includeTransliteration,
        includeNotes: options.includeNotes
      },
      glossary: options.glossaryEntries,
      lines: options.lines.map((line) => ({
        index: line.index,
        original: line.original,
        normalizedOriginal: line.normalizedOriginal ?? null,
        normalizationNotes: line.normalizationNotes ?? [],
        meaning: line.meaning ?? null,
        impliedMeaning: line.impliedMeaning ?? null,
        register: line.register ?? null,
        contextBefore: line.contextBefore ?? [],
        contextAfter: line.contextAfter ?? [],
        groupIndex: line.groupIndex ?? null,
        groupText: line.groupText ?? null,
        verseState: line.verseState ?? null,
        matchingCorrections: line.matchingCorrections ?? []
      }))
    },
    null,
    2
  );
}

function buildMeaningUserPrompt(options: RequestAiMeaningAnalysisOptions) {
  return JSON.stringify(
    {
      track: {
        title: options.title,
        artist: options.artist,
        album: options.album
      },
      sourceLanguage: options.sourceLanguage ?? "auto-detect from lyrics",
      songContext: options.songContext,
      artistMemory: serializeArtistMemoryForPrompt(options.artistMemory),
      glossary: options.glossaryEntries,
      lines: options.lines.map((line) => ({
        index: line.index,
        original: line.original,
        normalizedOriginal: line.normalizedOriginal ?? null,
        normalizationNotes: line.normalizationNotes ?? [],
        contextBefore: line.contextBefore ?? [],
        contextAfter: line.contextAfter ?? [],
        groupIndex: line.groupIndex ?? null,
        groupText: line.groupText ?? null,
        verseState: line.verseState ?? null,
        matchingCorrections: line.matchingCorrections ?? []
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
      songContext: options.songContext,
      artistMemory: serializeArtistMemoryForPrompt(options.artistMemory),
      outputRules: {
        exactLineCount: options.lines.length,
        includeTransliteration: options.includeTransliteration,
        includeNotes: options.includeNotes,
        preserveOrder: true,
        focus: ["semantic_accuracy", "slang_consistency", "candidate_quality"]
      },
      glossary: options.glossaryEntries,
      lines: options.lines.map((line) => ({
        index: line.index,
        original: line.original,
        normalizedOriginal: line.normalizedOriginal ?? null,
        meaning: line.meaning,
        impliedMeaning: line.impliedMeaning,
        register: line.register,
        currentDraft: {
          literal: line.literal,
          natural: line.natural,
          slangAware: line.slangAware,
          chosen: line.chosen,
          ambiguity: line.ambiguity,
          confidence: line.confidence
        },
        contextBefore: line.contextBefore ?? [],
        contextAfter: line.contextAfter ?? [],
        verseState: line.verseState ?? null,
        matchingCorrections: line.matchingCorrections ?? []
      }))
    },
    null,
    2
  );
}

function buildSongContextUserPrompt(options: RequestAiSongContextOptions) {
  return JSON.stringify(
    {
      track: {
        title: options.title,
        artist: options.artist,
        album: options.album
      },
      sourceLanguage: options.sourceLanguage ?? "auto-detect from lyrics",
      artistMemory: serializeArtistMemoryForPrompt(options.artistMemory),
      glossary: options.glossaryEntries,
      outputRules: {
        inferSpeakerAndAddressee: true,
        inferNarrativeMode: true
      },
      lines: options.lines
    },
    null,
    2
  );
}

function buildSelectionUserPrompt(options: RequestAiTranslationSelectionOptions) {
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
      artistMemory: serializeArtistMemoryForPrompt(options.artistMemory),
      outputRules: {
        exactLineCount: options.lines.length,
        includeTransliteration: options.includeTransliteration,
        includeNotes: options.includeNotes,
        focus: ["accuracy", "consistency", "conservative_choice"]
      },
      glossary: options.glossaryEntries,
      lines: options.lines.map((line) => ({
        index: line.index,
        original: line.original,
        normalizedOriginal: line.normalizedOriginal ?? null,
        meaning: line.meaning,
        impliedMeaning: line.impliedMeaning,
        register: line.register,
        candidates: {
          literal: line.literal,
          natural: line.natural,
          slangAware: line.slangAware,
          currentChosen: line.currentChosen
        },
        currentDraftMeta: {
          note: line.note,
          ambiguity: line.ambiguity,
          confidence: line.confidence
        },
        contextBefore: line.contextBefore ?? [],
        contextAfter: line.contextAfter ?? [],
        verseState: line.verseState ?? null,
        matchingCorrections: line.matchingCorrections ?? []
      }))
    },
    null,
    2
  );
}

function normalizeNullableString(value: unknown) {
  return value === null ? null : asString(value);
}

function extractContentText(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  const message = isRecord(payload.message) ? payload.message : null;
  return asString(message?.content);
}

function getOllamaErrorMessage(payload: unknown, fallbackMessage: string) {
  if (!isRecord(payload)) {
    return fallbackMessage;
  }

  return asString(payload.error) ?? fallbackMessage;
}

function matchesModelName(installedModelName: string, requestedModelName: string) {
  return (
    installedModelName === requestedModelName ||
    installedModelName.startsWith(`${requestedModelName}:`) ||
    requestedModelName.startsWith(`${installedModelName}:`)
  );
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
    const meaning = asString(line.meaning);
    const impliedMeaning = normalizeNullableString(line.impliedMeaning);
    const register = normalizeNullableString(line.register);
    const literal = asString(line.literal);
    const natural = asString(line.natural);
    const slangAware = asString(line.slangAware) ?? natural;
    const chosen = asString(line.chosen) ?? translated;
    const confidence = line.confidence === "low" || line.confidence === "medium" || line.confidence === "high" ? line.confidence : null;

    if (!translated || !meaning || !literal || !natural || !slangAware || !chosen || !confidence) {
      throw new Error(`${providerLabel} returned an empty translated line at index ${index}.`);
    }

    return {
      meaning,
      impliedMeaning,
      register,
      literal,
      natural,
      slangAware,
      chosen,
      translated,
      transliteration: normalizeNullableString(line.transliteration),
      note: normalizeNullableString(line.note),
      ambiguity: normalizeNullableString(line.ambiguity),
      confidence,
      selectorReason: normalizeNullableString(line.selectorReason)
    } satisfies GeneratedTranslationLineDraft;
  });

  return {
    sourceLanguage: detectedSourceLanguage,
    lines
  };
}

function parseMeaningResponse(
  parsed: unknown,
  expectedLineCount: number,
  providerLabel: string
): { sourceLanguage: string; lines: MeaningAnalysisLine[] } {
  const detectedSourceLanguage = isRecord(parsed) ? asString(parsed.detectedSourceLanguage) : null;

  if (!isRecord(parsed) || !detectedSourceLanguage || !Array.isArray(parsed.lines) || parsed.lines.length !== expectedLineCount) {
    throw new Error(`${providerLabel} returned an invalid meaning-analysis shape or changed the lyric line count.`);
  }

  return {
    sourceLanguage: detectedSourceLanguage,
    lines: parsed.lines.map((line, index) => {
      if (!isRecord(line)) {
        throw new Error(`${providerLabel} returned a non-object meaning-analysis line at index ${index}.`);
      }

      const meaning = asString(line.meaning);

      if (!meaning) {
        throw new Error(`${providerLabel} returned an empty meaning-analysis line at index ${index}.`);
      }

      return {
        meaning,
        impliedMeaning: normalizeNullableString(line.impliedMeaning),
        register: normalizeNullableString(line.register)
      };
    })
  };
}

function parseSongContextResponse(parsed: unknown, providerLabel: string): { sourceLanguage: string; songContext: AiSongContext } {
  const detectedSourceLanguage = isRecord(parsed) ? asString(parsed.detectedSourceLanguage) : null;
  const summary = isRecord(parsed) ? asString(parsed.summary) : null;
  const speaker = isRecord(parsed) ? normalizeNullableString(parsed.speaker) : null;
  const addressee = isRecord(parsed) ? normalizeNullableString(parsed.addressee) : null;
  const stance = isRecord(parsed) ? normalizeNullableString(parsed.stance) : null;
  const narrativeMode = isRecord(parsed) ? normalizeNullableString(parsed.narrativeMode) : null;
  const tone = isRecord(parsed) ? asString(parsed.tone) : null;
  const themes = isRecord(parsed) && Array.isArray(parsed.themes)
    ? parsed.themes.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  const notablePhrases = isRecord(parsed) && Array.isArray(parsed.notablePhrases)
    ? parsed.notablePhrases.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];

  if (!detectedSourceLanguage || !summary || !tone) {
    throw new Error(`${providerLabel} returned an invalid song-context shape.`);
  }

  return {
    sourceLanguage: detectedSourceLanguage,
    songContext: {
      summary,
      themes,
      tone,
      notablePhrases,
      speaker,
      addressee,
      stance,
      narrativeMode
    }
  };
}

function parseSelectionResponse(
  parsed: unknown,
  expectedLineCount: number,
  providerLabel: string
): {
  sourceLanguage: string;
  lines: Array<{
    chosen: string;
    confidence: "low" | "medium" | "high";
    ambiguity: string | null;
    note: string | null;
    selectorReason: string | null;
  }>;
} {
  const detectedSourceLanguage = isRecord(parsed) ? asString(parsed.detectedSourceLanguage) : null;

  if (!isRecord(parsed) || !detectedSourceLanguage || !Array.isArray(parsed.lines) || parsed.lines.length !== expectedLineCount) {
    throw new Error(`${providerLabel} returned an invalid selection shape or changed the lyric line count.`);
  }

  return {
    sourceLanguage: detectedSourceLanguage,
    lines: parsed.lines.map((line, index) => {
      if (!isRecord(line)) {
        throw new Error(`${providerLabel} returned a non-object selection line at index ${index}.`);
      }

      const chosen = asString(line.chosen);
      const confidence = line.confidence === "low" || line.confidence === "medium" || line.confidence === "high" ? line.confidence : null;

      if (!chosen || !confidence) {
        throw new Error(`${providerLabel} returned an invalid selection line at index ${index}.`);
      }

      return {
        chosen,
        confidence,
        ambiguity: normalizeNullableString(line.ambiguity),
        note: normalizeNullableString(line.note),
        selectorReason: normalizeNullableString(line.selectorReason)
      };
    })
  };
}

async function callOllamaJson<T>(options: {
  model: string;
  schema: unknown;
  systemPrompt: string;
  userPrompt: string;
  errorLabel: string;
  temperature: number;
}): Promise<T> {
  const response = await fetch(`${getOllamaApiBaseUrl()}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    signal: AbortSignal.timeout(OLLAMA_REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: options.model,
      stream: false,
      format: options.schema,
      options: {
        temperature: options.temperature
      },
      messages: [
        {
          role: "system",
          content: options.systemPrompt
        },
        {
          role: "user",
          content: options.userPrompt
        }
      ]
    })
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(getOllamaErrorMessage(payload, `${options.errorLabel} failed with status ${response.status}.`));
  }

  const outputText = extractContentText(payload);

  if (!outputText) {
    throw new Error(`Ollama returned an empty response for ${options.errorLabel.toLowerCase()}.`);
  }

  try {
    return JSON.parse(outputText) as T;
  } catch {
    throw new Error(`Ollama returned JSON that could not be parsed for ${options.errorLabel.toLowerCase()}.`);
  }
}

export async function inspectOllamaStatus(): Promise<AiProviderStatus> {
  const baseUrl = getOllamaBaseUrl();
  const model = getOllamaModel();

  try {
    const response = await fetch(`${getOllamaApiBaseUrl()}/tags`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2_000)
    });
    const payload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      return {
        provider: "ollama",
        baseUrl,
        model,
        available: false,
        modelAvailable: false,
        installedModels: [],
        errorMessage: getOllamaErrorMessage(payload, `Ollama status check failed with status ${response.status}.`)
      };
    }

    const models = Array.isArray((payload as { models?: unknown }).models)
      ? ((payload as { models: unknown[] }).models
          .map((entry) => (isRecord(entry) ? asString(entry.name) : null))
          .filter((entry): entry is string => Boolean(entry)))
      : [];

    return {
      provider: "ollama",
      baseUrl,
      model,
      available: true,
      modelAvailable: models.some((installedModelName) => matchesModelName(installedModelName, model)),
      installedModels: models,
      errorMessage: null
    };
  } catch (error) {
    return {
      provider: "ollama",
      baseUrl,
      model,
      available: false,
      modelAvailable: false,
      installedModels: [],
      errorMessage:
        error instanceof Error
          ? `Could not reach Ollama at ${baseUrl}. Start the Ollama app or run \`ollama serve\` first.`
          : `Could not reach Ollama at ${baseUrl}.`
    };
  }
}

export async function requestAiSongContext(
  options: RequestAiSongContextOptions
): Promise<{ model: string; sourceLanguage: string; songContext: AiSongContext }> {
  const model = getOllamaModel();
  const parsed = await callOllamaJson<unknown>({
    model,
    schema: buildSongContextSchema(),
    systemPrompt: buildSongContextSystemPrompt(options),
    userPrompt: buildSongContextUserPrompt(options),
    errorLabel: "Ollama song-context request",
    temperature: 0.1
  });
  const normalized = parseSongContextResponse(parsed, "Ollama");

  return {
    model,
    sourceLanguage: normalized.sourceLanguage,
    songContext: normalized.songContext
  };
}

export async function requestAiMeaningAnalysis(
  options: RequestAiMeaningAnalysisOptions
): Promise<{ model: string; sourceLanguage: string; lines: MeaningAnalysisLine[] }> {
  if (options.lines.length === 0) {
    throw new Error("No lyric lines were provided to the AI meaning-analysis generator.");
  }

  const model = getOllamaModel();
  const parsed = await callOllamaJson<unknown>({
    model,
    schema: buildMeaningSchema(options.lines.length),
    systemPrompt: buildMeaningSystemPrompt(options),
    userPrompt: buildMeaningUserPrompt(options),
    errorLabel: "Ollama meaning-analysis request",
    temperature: 0.05
  });
  const normalized = parseMeaningResponse(parsed, options.lines.length, "Ollama");

  return {
    model,
    sourceLanguage: normalized.sourceLanguage,
    lines: normalized.lines
  };
}

export async function requestAiTranslationDraft(
  options: RequestAiTranslationDraftOptions
): Promise<{ model: string; sourceLanguage: string; lines: GeneratedTranslationLineDraft[] }> {
  if (options.lines.length === 0) {
    throw new Error("No lyric lines were provided to the AI translation generator.");
  }

  const model = getOllamaModel();
  const parsed = await callOllamaJson<unknown>({
    model,
    schema: buildDraftSchema(options.lines.length),
    systemPrompt: buildSystemPrompt(options),
    userPrompt: buildUserPrompt(options),
    errorLabel: "Ollama translation request",
    temperature: 0.1
  });
  const normalized = parseGeneratedLines(parsed, options.lines.length, "Ollama");

  return {
    model,
    sourceLanguage: normalized.sourceLanguage,
    lines: normalized.lines
  };
}

export async function requestAiTranslationRefinement(
  options: RequestAiTranslationRefinementOptions
): Promise<{ model: string; sourceLanguage: string; lines: GeneratedTranslationLineDraft[] }> {
  if (options.lines.length === 0) {
    throw new Error("No lyric lines were provided to the AI refinement generator.");
  }

  const model = getOllamaModel();
  const parsed = await callOllamaJson<unknown>({
    model,
    schema: buildDraftSchema(options.lines.length),
    systemPrompt: buildRefinementSystemPrompt(options),
    userPrompt: buildRefinementUserPrompt(options),
    errorLabel: "Ollama refinement request",
    temperature: 0.05
  });
  const normalized = parseGeneratedLines(parsed, options.lines.length, "Ollama");

  return {
    model,
    sourceLanguage: normalized.sourceLanguage,
    lines: normalized.lines
  };
}

export async function requestAiTranslationSelection(
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
  if (options.lines.length === 0) {
    throw new Error("No lyric lines were provided to the AI selector.");
  }

  const model = getOllamaModel();
  const parsed = await callOllamaJson<unknown>({
    model,
    schema: buildSelectionSchema(options.lines.length),
    systemPrompt: buildSelectionSystemPrompt(options),
    userPrompt: buildSelectionUserPrompt(options),
    errorLabel: "Ollama selection request",
    temperature: 0.05
  });
  const normalized = parseSelectionResponse(parsed, options.lines.length, "Ollama");

  return {
    model,
    sourceLanguage: normalized.sourceLanguage,
    lines: normalized.lines
  };
}
