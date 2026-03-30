import type { AiGlossaryEntry } from "@/features/ai/glossary";
import { serializeArtistMemoryForPrompt } from "@/features/ai/artist-profile-format";
import type { PreviousTranslationRef } from "@/features/ai/provider";
import type {
  AiArtistMemory,
  AiCorrectionHint,
  AiProviderStatus,
  AiSongContext,
  AiVerseState,
  GeneratedTranslationLineDraft,
  MeaningAnalysisLine
} from "@/features/ai/types";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_GENERATOR_A_MODEL = "gpt-5.1";
const OPENAI_REQUEST_TIMEOUT_MS = 180_000;

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
    previousTranslation?: PreviousTranslationRef | null;
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
    previousTranslation?: PreviousTranslationRef | null;
  }>;
};

type RequestAiSongContextOptions = BasePromptOptions & {
  sourceLanguage: string | null;
  lines: Array<{
    index: number;
    original: string;
  }>;
};

type RequestAiArtistProfileOptions = {
  artistKey: string;
  artistName: string;
  glossaryEntries: AiGlossaryEntry[];
  evidence: Array<{
    spotifyTrackId: string;
    title: string;
    album: string;
    generatedAt: string;
    songContext: AiSongContext | null;
    lines: Array<{
      original: string;
      chosen: string;
      meaning: string;
      register: string | null;
      confidence: "low" | "medium" | "high";
      selectorReason: string | null;
    }>;
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
    previousTranslation?: PreviousTranslationRef | null;
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

export function getOpenAiGeneratorAModel() {
  const value = process.env.OPENAI_GENERATOR_A_MODEL ?? process.env.OPENAI_MODEL;
  if (value && value.trim().length > 0) return value.trim();
  try {
    const { readSettingsSync } = require("@/features/settings/repository") as { readSettingsSync: () => { generatorAModel: string } };
    const model = readSettingsSync().generatorAModel;
    if (model) return model;
  } catch {}
  return DEFAULT_OPENAI_GENERATOR_A_MODEL;
}

export async function resolveOpenAiGeneratorAModel() {
  const value = process.env.OPENAI_GENERATOR_A_MODEL ?? process.env.OPENAI_MODEL;
  if (value && value.trim().length > 0) return value.trim();

  const { readSettings } = (await import("@/features/settings/repository")) as {
    readSettings: () => Promise<{ generatorAModel: string }>;
  };
  const model = (await readSettings()).generatorAModel;
  return model || DEFAULT_OPENAI_GENERATOR_A_MODEL;
}

export function getOpenAiModel() {
  return getOpenAiGeneratorAModel();
}

export async function resolveOpenAiModel() {
  return resolveOpenAiGeneratorAModel();
}

export function isOpenAiConfigured() {
  return typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.trim().length > 0;
}

export function buildDraftSchema(lineCount: number) {
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
            natural: { type: "string" },
            slangAware: { type: "string" },
            chosen: { type: "string" },
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
          required: [
            "literal",
            "natural",
            "slangAware",
            "chosen",
            "transliteration",
            "note",
            "ambiguity",
            "confidence"
          ]
        }
      }
    },
    required: ["detectedSourceLanguage", "lines"]
  };
}

export function buildMeaningSchema(lineCount: number) {
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

export function buildSongContextSchema() {
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

export function buildArtistProfileSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      displayName: { type: "string" },
      personaSummary: {
        anyOf: [{ type: "string" }, { type: "null" }]
      },
      translationPreferences: {
        type: "array",
        items: { type: "string" }
      },
      translationDirectives: {
        type: "array",
        items: { type: "string" }
      },
      recurringThemes: {
        type: "array",
        items: { type: "string" }
      },
      recurringMotifs: {
        type: "array",
        items: { type: "string" }
      },
      relationshipPatterns: {
        type: "array",
        items: { type: "string" }
      },
      toneNotes: {
        type: "array",
        items: { type: "string" }
      },
      voiceNotes: {
        type: "array",
        items: { type: "string" }
      },
      stanceNotes: {
        type: "array",
        items: { type: "string" }
      },
      perspectiveNotes: {
        type: "array",
        items: { type: "string" }
      },
      notes: {
        type: "array",
        items: { type: "string" }
      }
    },
    required: [
      "displayName",
      "personaSummary",
      "translationPreferences",
      "translationDirectives",
      "recurringThemes",
      "recurringMotifs",
      "relationshipPatterns",
      "toneNotes",
      "voiceNotes",
      "stanceNotes",
      "perspectiveNotes",
      "notes"
    ]
  };
}

export function buildSelectionSchema(lineCount: number) {
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
    hints.push(
      "Artist memory is provided in the request. Apply the artist's translationPreferences, translationDirectives, and canonicalRenderings to every line without exception. Preserve the artist's persona, stance, and relationship posture: keep recurring flex, tenderness, warning, pride, or vulnerability cues intact instead of flattening them into generic English."
    );
  }

  if (options.glossaryEntries.length > 0) {
    hints.push("Use the provided glossary meanings whenever a matching slang word, idiom, phrase, or reference appears.");
  }

  return hints.join(" ");
}

export function buildSystemPrompt(options: RequestAiTranslationDraftOptions) {
  return [
    "You help draft lyric translations for Lafz, a personal local-first translation tool.",
    options.sourceLanguage
      ? `Translate each lyric line from ${options.sourceLanguage} into ${options.targetLanguage}.`
      : `First infer the lyric language from the provided lines, then translate each line into ${options.targetLanguage}.`,
    "These lyrics may be romanized Punjabi, Hindi, or Urdu written in Latin script, not English.",
    "Preserve the input order exactly. Do not merge, split, reorder, or omit lines.",
    "For each line, produce literal, natural, slangAware, chosen, transliteration, note, ambiguity, and confidence.",
    "The meaning, impliedMeaning, and register for each line are already provided as input — use them to guide translation but do not output them.",
    "Literal must stay very close to the original meaning, even if the English sounds plain.",
    "Natural should sound like clean English while keeping the actual meaning.",
    "SlangAware should preserve swagger, idiom, and lyrical tone without inventing new meaning.",
    "Chosen should be the strongest conservative final line for display.",
    "Do not invent scenes, emotions, or metaphors that are not present in the original line.",
    "Use nearby context, verse group context, song context, artist memory, and glossary hints to disambiguate meaning.",
    "If verseState is provided for a line, treat it as a strong local-context signal for stance, target, and what the surrounding block is doing.",
    "If a line includes correction examples, treat them as strong guidance for similar phrasing unless the current context clearly changes the meaning.",
    "If a line includes previousTranslation, use it as a reference baseline — think independently but maintain terminology and tone consistency with previous high-confidence choices.",
    "If previousTranslation.manuallyReviewed is true, treat that choice as user-approved and preserve it unless you identify a clear semantic error.",
    "If previousTranslation.confidence is low, that line previously struggled — pay extra attention and try to produce a clearly better result.",
    "If the meaning is uncertain, keep chosen conservative and explain uncertainty in ambiguity or note instead of guessing confidently.",
    options.includeTransliteration
      ? "Return transliteration only when it adds value. If the original line is already in Latin characters or transliteration would be redundant, return null."
      : "Return null for transliteration on every line.",
    options.includeNotes
      ? "Return a short note only when slang, cultural context, wordplay, or double meaning needs explanation. Otherwise return null."
      : "Return null for note on every line.",
    "Set confidence to low, medium, or high based on how certain you are about the line meaning.",
    buildSharedContextHints(options, options.sourceLanguage),
    "Respond only with JSON matching the schema."
  ].join(" ");
}

export function buildMeaningSystemPrompt(options: RequestAiMeaningAnalysisOptions) {
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

export function buildRefinementSystemPrompt(options: RequestAiTranslationRefinementOptions) {
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
    "If a line includes previousTranslation, use it as a reference — maintain consistency with previous high-confidence choices, give extra attention to improving low-confidence ones, and preserve manually-reviewed choices unless there is a clear error.",
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

export function buildSongContextSystemPrompt(options: RequestAiSongContextOptions) {
  return [
    "You are summarizing song context for Lafz before translation.",
    "These lyrics may be romanized Punjabi, Hindi, or Urdu written in Latin script.",
    "Infer the most likely song-level themes, attitude, recurring ideas, speaker, addressee, stance, and narrative mode without overclaiming.",
    "Keep the summary concise and grounded in the provided lines.",
    buildSharedContextHints(options, options.sourceLanguage),
    "Respond only with JSON matching the schema."
  ].join(" ");
}

export function buildArtistProfileSystemPrompt(options: RequestAiArtistProfileOptions) {
  return [
    "You are building an artist profile for Lafz, a lyric-translation system.",
    "Your job is to infer how this artist usually speaks, postures, relates to people, and what translation guidance Lafz should remember.",
    "Use only the evidence provided: glossary entries, past translated lines, song-context summaries, and line-level registers.",
    "Do not invent biographical facts or external information.",
    "Keep all outputs compact, practical, and translation-oriented.",
    "translationPreferences should describe how Lafz should generally render this artist in English.",
    "translationDirectives should be crisp rules like 'do not soften threats' or 'keep romantic lines proud, not submissive'.",
    "recurringThemes and recurringMotifs should capture what repeatedly shows up across songs.",
    "relationshipPatterns should explain how the artist usually talks to lovers, rivals, friends, enemies, or listeners.",
    "toneNotes, voiceNotes, stanceNotes, and perspectiveNotes should help preserve the artist's point of view and social posture in translation.",
    "personaSummary should be a concise paragraph, not generic fluff.",
    "If the evidence is thin, stay conservative and leave weak categories empty rather than guessing.",
    "Respond only with JSON matching the schema."
  ].join(" ");
}

export function buildSelectionSystemPrompt(options: RequestAiTranslationSelectionOptions) {
  return [
    "You are the final selector for Lafz lyric translations.",
    `The source lyrics are in ${options.sourceLanguage}. Select the best final English line for each entry.`,
    "Choose among the candidate translations by prioritizing semantic accuracy first, then slang correctness, then lyrical naturalness.",
    "Use song context, artist memory, glossary hints, and nearby chosen lines to keep the whole song consistent.",
    "If verseState is provided, use it to preserve local block intent and to avoid selecting a line that sounds good but belongs to a different moment in the song.",
    "If manual correction examples are provided for a line, treat them as strong guidance and stay aligned with their corrected meaning unless the current context clearly changes it.",
    "If a line includes previousTranslation, factor it into your selection — prefer consistency with previous high-confidence choices, prioritise improving low-confidence ones, and treat manually-reviewed choices as near-final unless there is a clear error.",
    "Do not rewrite the original meaning into something flashier than the lyric actually says.",
    "If the candidates are all weak, choose the most conservative one, reduce confidence, and explain ambiguity or note instead of guessing.",
    buildSharedContextHints(options, options.sourceLanguage),
    "Respond only with JSON matching the schema."
  ].join(" ");
}

export function buildArtistProfileUserPrompt(options: RequestAiArtistProfileOptions) {
  return JSON.stringify(
    {
      artist: {
        artistKey: options.artistKey,
        displayName: options.artistName
      },
      glossary: options.glossaryEntries,
      evidence: options.evidence
    },
    null,
    2
  );
}

export function buildUserPrompt(options: RequestAiTranslationDraftOptions) {
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
        matchingCorrections: line.matchingCorrections ?? [],
        previousTranslation: line.previousTranslation ?? null
      }))
    },
    null,
    2
  );
}

export function buildMeaningUserPrompt(options: RequestAiMeaningAnalysisOptions) {
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

export function buildRefinementUserPrompt(options: RequestAiTranslationRefinementOptions) {
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
        matchingCorrections: line.matchingCorrections ?? [],
        previousTranslation: line.previousTranslation ?? null
      }))
    },
    null,
    2
  );
}

export function buildSongContextUserPrompt(options: RequestAiSongContextOptions) {
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

export function buildSelectionUserPrompt(options: RequestAiTranslationSelectionOptions) {
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
        matchingCorrections: line.matchingCorrections ?? [],
        previousTranslation: line.previousTranslation ?? null
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

function parseStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
}

function extractOpenAiErrorMessage(payload: unknown, fallbackMessage: string) {
  if (!isRecord(payload)) {
    return fallbackMessage;
  }

  const error = isRecord(payload.error) ? payload.error : null;
  return asString(error?.message) ?? fallbackMessage;
}

async function callOpenAiJson<T>(options: {
  model: string;
  schemaName: string;
  schema: unknown;
  systemPrompt: string;
  userPrompt: string;
  errorLabel: string;
  usageSink?: { inputTokens: number; outputTokens: number };
}): Promise<T> {
  const response = await fetch(`${getOpenAiBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: getOpenAiAuthHeaders(),
    signal: AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: options.model,
      messages: [
        {
          role: "system",
          content: options.systemPrompt
        },
        {
          role: "user",
          content: options.userPrompt
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: options.schemaName,
          strict: true,
          schema: options.schema
        }
      }
    })
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(extractOpenAiErrorMessage(payload, `${options.errorLabel} failed with status ${response.status}.`));
  }

  if (options.usageSink && isRecord(payload) && isRecord(payload.usage)) {
    const usage = payload.usage;
    if (typeof usage.prompt_tokens === "number") options.usageSink.inputTokens += usage.prompt_tokens;
    if (typeof usage.completion_tokens === "number") options.usageSink.outputTokens += usage.completion_tokens;
  }

  const choices = Array.isArray((payload as { choices?: unknown }).choices)
    ? (payload as { choices: unknown[] }).choices.filter(isRecord)
    : [];
  const firstChoice = choices[0] ?? null;
  const message = firstChoice && isRecord(firstChoice.message) ? firstChoice.message : null;
  const refusal = asString(message?.refusal);

  if (refusal) {
    throw new Error(`OpenAI refused the request: ${refusal}`);
  }

  const outputText = asString(message?.content);

  if (!outputText) {
    throw new Error(`OpenAI returned an empty response for ${options.errorLabel.toLowerCase()}.`);
  }

  try {
    return JSON.parse(outputText) as T;
  } catch {
    throw new Error(`OpenAI returned JSON that could not be parsed for ${options.errorLabel.toLowerCase()}.`);
  }
}

export function parseGeneratedLines(
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

    const literal = asString(line.literal);
    const natural = asString(line.natural);
    const slangAware = asString(line.slangAware) ?? natural;
    const chosen = asString(line.chosen);
    const confidence = line.confidence === "low" || line.confidence === "medium" || line.confidence === "high" ? line.confidence : null;

    if (!literal || !natural || !slangAware || !chosen || !confidence) {
      throw new Error(`${providerLabel} returned an empty translated line at index ${index}.`);
    }

    return {
      literal,
      natural,
      slangAware,
      chosen,
      transliteration: normalizeNullableString(line.transliteration),
      note: normalizeNullableString(line.note),
      ambiguity: normalizeNullableString(line.ambiguity),
      confidence,
      selectorReason: null
    } satisfies GeneratedTranslationLineDraft;
  });

  return {
    sourceLanguage: detectedSourceLanguage,
    lines
  };
}

export function parseMeaningResponse(
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

export function parseSongContextResponse(parsed: unknown, providerLabel: string): { sourceLanguage: string; songContext: AiSongContext } {
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

export function parseSelectionResponse(
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

export async function inspectOpenAiStatus(): Promise<AiProviderStatus> {
  const baseUrl = getOpenAiBaseUrl();
  const model = await resolveOpenAiModel();

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

export async function requestOpenAiSongContext(
  options: RequestAiSongContextOptions
): Promise<{ model: string; sourceLanguage: string; songContext: AiSongContext }> {
  const model = await resolveOpenAiModel();
  const parsed = await callOpenAiJson<unknown>({
    model,
    schemaName: "lafz_song_context",
    schema: buildSongContextSchema(),
    systemPrompt: buildSongContextSystemPrompt(options),
    userPrompt: buildSongContextUserPrompt(options),
    errorLabel: "OpenAI song-context request"
  });
  const normalized = parseSongContextResponse(parsed, "OpenAI");

  return {
    model,
    sourceLanguage: normalized.sourceLanguage,
    songContext: normalized.songContext
  };
}

export async function requestOpenAiArtistProfile(options: RequestAiArtistProfileOptions): Promise<{
  model: string;
  profile: {
    displayName: string;
    personaSummary: string | null;
    translationPreferences: string[];
    translationDirectives: string[];
    recurringThemes: string[];
    recurringMotifs: string[];
    relationshipPatterns: string[];
    toneNotes: string[];
    voiceNotes: string[];
    stanceNotes: string[];
    perspectiveNotes: string[];
    notes: string[];
  };
}> {
  const model = await resolveOpenAiModel();
  const parsed = await callOpenAiJson<unknown>({
    model,
    schemaName: "lafz_artist_profile",
    schema: buildArtistProfileSchema(),
    systemPrompt: buildArtistProfileSystemPrompt(options),
    userPrompt: buildArtistProfileUserPrompt(options),
    errorLabel: "OpenAI artist-profile request"
  });

  if (!isRecord(parsed)) {
    throw new Error("OpenAI returned an invalid artist-profile shape.");
  }

  return {
    model,
    profile: {
      displayName: asString(parsed.displayName) ?? options.artistName,
      personaSummary: normalizeNullableString(parsed.personaSummary),
      translationPreferences: parseStringArray(parsed.translationPreferences),
      translationDirectives: parseStringArray(parsed.translationDirectives),
      recurringThemes: parseStringArray(parsed.recurringThemes),
      recurringMotifs: parseStringArray(parsed.recurringMotifs),
      relationshipPatterns: parseStringArray(parsed.relationshipPatterns),
      toneNotes: parseStringArray(parsed.toneNotes),
      voiceNotes: parseStringArray(parsed.voiceNotes),
      stanceNotes: parseStringArray(parsed.stanceNotes),
      perspectiveNotes: parseStringArray(parsed.perspectiveNotes),
      notes: parseStringArray(parsed.notes)
    }
  };
}

export async function requestOpenAiMeaningAnalysis(
  options: RequestAiMeaningAnalysisOptions
): Promise<{ model: string; sourceLanguage: string; lines: MeaningAnalysisLine[] }> {
  if (options.lines.length === 0) {
    throw new Error("No lyric lines were provided to the AI meaning-analysis generator.");
  }

  const model = await resolveOpenAiModel();
  const parsed = await callOpenAiJson<unknown>({
    model,
    schemaName: "lafz_meaning_analysis",
    schema: buildMeaningSchema(options.lines.length),
    systemPrompt: buildMeaningSystemPrompt(options),
    userPrompt: buildMeaningUserPrompt(options),
    errorLabel: "OpenAI meaning-analysis request"
  });
  const normalized = parseMeaningResponse(parsed, options.lines.length, "OpenAI");

  return {
    model,
    sourceLanguage: normalized.sourceLanguage,
    lines: normalized.lines
  };
}

export async function requestOpenAiTranslationDraft(
  options: RequestAiTranslationDraftOptions,
  usageSink?: { inputTokens: number; outputTokens: number }
): Promise<{ model: string; sourceLanguage: string; lines: GeneratedTranslationLineDraft[]; usage: { inputTokens: number; outputTokens: number } }> {
  if (options.lines.length === 0) {
    throw new Error("No lyric lines were provided to the AI translation generator.");
  }

  const localSink = { inputTokens: 0, outputTokens: 0 };
  const model = await resolveOpenAiModel();
  const parsed = await callOpenAiJson<unknown>({
    model,
    schemaName: "lafz_translation_draft",
    schema: buildDraftSchema(options.lines.length),
    systemPrompt: buildSystemPrompt(options),
    userPrompt: buildUserPrompt(options),
    errorLabel: "OpenAI translation request",
    usageSink: localSink
  });
  const normalized = parseGeneratedLines(parsed, options.lines.length, "OpenAI");

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

export async function requestOpenAiTranslationRefinement(
  options: RequestAiTranslationRefinementOptions
): Promise<{ model: string; sourceLanguage: string; lines: GeneratedTranslationLineDraft[] }> {
  if (options.lines.length === 0) {
    throw new Error("No lyric lines were provided to the AI refinement generator.");
  }

  const model = await resolveOpenAiModel();
  const parsed = await callOpenAiJson<unknown>({
    model,
    schemaName: "lafz_translation_refinement",
    schema: buildDraftSchema(options.lines.length),
    systemPrompt: buildRefinementSystemPrompt(options),
    userPrompt: buildRefinementUserPrompt(options),
    errorLabel: "OpenAI refinement request"
  });
  const normalized = parseGeneratedLines(parsed, options.lines.length, "OpenAI");

  return {
    model,
    sourceLanguage: normalized.sourceLanguage,
    lines: normalized.lines
  };
}

export async function requestOpenAiTranslationSelection(
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

  const model = await resolveOpenAiModel();
  const parsed = await callOpenAiJson<unknown>({
    model,
    schemaName: "lafz_translation_selection",
    schema: buildSelectionSchema(options.lines.length),
    systemPrompt: buildSelectionSystemPrompt(options),
    userPrompt: buildSelectionUserPrompt(options),
    errorLabel: "OpenAI selection request"
  });
  const normalized = parseSelectionResponse(parsed, options.lines.length, "OpenAI");

  return {
    model,
    sourceLanguage: normalized.sourceLanguage,
    lines: normalized.lines
  };
}
