import type { AiGlossaryEntry } from "@/features/ai/glossary";
import { serializeArtistMemoryForPrompt } from "@/features/ai/artist-profile-format";
import type {
  AiArtistMemory,
  AiCorrectionHint,
  PreviousTranslationRef,
  AiSongContext,
  AiVerseState,
  AiWorldModel,
  AiWorldModelLine,
  GeneratedTranslationLineDraft,
  MeaningAnalysisLine
} from "@/features/ai/types";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_GENERATOR_A_MODEL = "gpt-5.4-mini";
const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
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
  worldModel: AiWorldModel | null;
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
    lineWorldModel?: AiWorldModelLine | null;
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

type RequestAiSongContextOptions = BasePromptOptions & {
  sourceLanguage: string | null;
  lines: Array<{
    index: number;
    original: string;
  }>;
};

type RequestAiWorldModelOptions = BasePromptOptions & {
  sourceLanguage: string | null;
  songContext: AiSongContext | null;
  lines: Array<{
    index: number;
    original: string;
    normalizedOriginal?: string | null;
    meaning: string;
    impliedMeaning: string | null;
    register: string | null;
    groupIndex?: number | null;
    groupText?: string | null;
  }>;
  verses: Array<{
    groupIndex: number;
    startOrder: number;
    endOrder: number;
    text: string;
  }>;
};

type RequestAiSurfacePolishOptions = BasePromptOptions & {
  sourceLanguage: string | null;
  targetLanguage: string;
  songContext: AiSongContext | null;
  worldModel: AiWorldModel | null;
  lines: Array<{
    index: number;
    original: string;
    chosen: string;
    meaning: string;
    impliedMeaning?: string | null;
    register?: string | null;
    contextBefore?: Array<{ original: string; chosen: string }>;
    contextAfter?: Array<{ original: string; chosen: string }>;
    verseState?: AiVerseState | null;
    lineWorldModel?: AiWorldModelLine | null;
    protectedAnchors: string[];
  }>;
};

type RequestAiSurfacePolishAuditOptions = BasePromptOptions & {
  sourceLanguage: string | null;
  targetLanguage: string;
  songContext: AiSongContext | null;
  worldModel: AiWorldModel | null;
  lines: Array<{
    index: number;
    original: string;
    originalChosen: string;
    safePolish: string;
    naturalPolish: string;
    meaning: string;
    impliedMeaning?: string | null;
    register?: string | null;
    verseState?: AiVerseState | null;
    lineWorldModel?: AiWorldModelLine | null;
    protectedAnchors: string[];
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

type RequestAiVocabularyCandidatesOptions = BasePromptOptions & {
  sourceLanguage: string | null;
  targetLanguage: string;
  songContext: AiSongContext | null;
  worldModel: AiWorldModel | null;
  existingTerms?: string[];
  lines: Array<{
    order: number;
    original: string;
    normalizedOriginal?: string | null;
    meaning: string;
    impliedMeaning?: string | null;
    chosen: string;
    note?: string | null;
    confidence: "low" | "medium" | "high";
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

export function buildSurfacePolishSchema(lineCount: number) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      lines: {
        type: "array",
        minItems: lineCount,
        maxItems: lineCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            apply: { type: "boolean" },
            reason: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            safePolish: { type: "string" },
            naturalPolish: { type: "string" }
          },
          required: ["apply", "reason", "safePolish", "naturalPolish"]
        }
      }
    },
    required: ["lines"]
  };
}

export function buildSurfacePolishAuditSchema(lineCount: number) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      lines: {
        type: "array",
        minItems: lineCount,
        maxItems: lineCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            winner: {
              type: "string",
              enum: ["original", "safe", "natural"]
            },
            chosen: { type: "string" },
            reason: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            fluencyGain: {
              type: "string",
              enum: ["none", "minor", "clear"]
            },
            semanticRisk: {
              type: "string",
              enum: ["low", "medium", "high"]
            }
          },
          required: ["winner", "chosen", "reason", "fluencyGain", "semanticRisk"]
        }
      }
    },
    required: ["lines"]
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

export function buildWorldModelSchema(verseCount: number, lineCount: number) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      detectedSourceLanguage: { type: "string" },
      summary: { type: "string" },
      speakerPersona: {
        anyOf: [{ type: "string" }, { type: "null" }]
      },
      addressee: {
        anyOf: [{ type: "string" }, { type: "null" }]
      },
      narrativeDrive: {
        anyOf: [{ type: "string" }, { type: "null" }]
      },
      dominantConflict: {
        anyOf: [{ type: "string" }, { type: "null" }]
      },
      relationshipFrame: {
        anyOf: [{ type: "string" }, { type: "null" }]
      },
      worldState: {
        anyOf: [{ type: "string" }, { type: "null" }]
      },
      coreMotifs: {
        type: "array",
        items: { type: "string" }
      },
      recurringSymbols: {
        type: "array",
        items: { type: "string" }
      },
      powerDynamics: {
        type: "array",
        items: { type: "string" }
      },
      continuityRules: {
        type: "array",
        items: { type: "string" }
      },
      entities: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            entityKey: { type: "string" },
            label: { type: "string" },
            role: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            description: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            aliases: {
              type: "array",
              items: { type: "string" }
            },
            salience: {
              type: "string",
              enum: ["low", "medium", "high"]
            }
          },
          required: ["entityKey", "label", "role", "description", "aliases", "salience"]
        }
      },
      relationshipGraph: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            sourceEntity: { type: "string" },
            targetEntity: { type: "string" },
            dynamic: { type: "string" },
            powerBalance: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            evidence: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            confidence: {
              type: "string",
              enum: ["low", "medium", "high"]
            }
          },
          required: ["sourceEntity", "targetEntity", "dynamic", "powerBalance", "evidence", "confidence"]
        }
      },
      verseModels: {
        type: "array",
        minItems: verseCount,
        maxItems: verseCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            groupIndex: { type: "number" },
            startOrder: { type: "number" },
            endOrder: { type: "number" },
            sceneSummary: { type: "string" },
            stance: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            target: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            dominantIntents: {
              type: "array",
              items: { type: "string" }
            },
            tension: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            powerMove: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            continuityNote: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            imagery: {
              type: "array",
              items: { type: "string" }
            },
            activeEntities: {
              type: "array",
              items: { type: "string" }
            },
            interactionType: {
              anyOf: [{ type: "string" }, { type: "null" }]
            }
          },
          required: [
            "groupIndex",
            "startOrder",
            "endOrder",
            "sceneSummary",
            "stance",
            "target",
            "dominantIntents",
            "tension",
            "powerMove",
            "continuityNote",
            "imagery",
            "activeEntities",
            "interactionType"
          ]
        }
      },
      lineModels: {
        type: "array",
        minItems: lineCount,
        maxItems: lineCount,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            order: { type: "number" },
            subject: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            action: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            target: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            socialMove: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            emotionalColor: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            hiddenMeaning: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            imagery: {
              type: "array",
              items: { type: "string" }
            },
            referents: {
              type: "array",
              items: { type: "string" }
            },
            entityLinks: {
              type: "array",
              items: { type: "string" }
            },
            caution: {
              anyOf: [{ type: "string" }, { type: "null" }]
            }
          },
          required: [
            "order",
            "subject",
            "action",
            "target",
            "socialMove",
            "emotionalColor",
            "hiddenMeaning",
            "imagery",
            "referents",
            "entityLinks",
            "caution"
          ]
        }
      }
    },
    required: [
      "detectedSourceLanguage",
      "summary",
      "speakerPersona",
      "addressee",
      "narrativeDrive",
      "dominantConflict",
      "relationshipFrame",
      "worldState",
      "coreMotifs",
      "recurringSymbols",
      "powerDynamics",
      "continuityRules",
      "entities",
      "relationshipGraph",
      "verseModels",
      "lineModels"
    ]
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

export function buildVocabularyCandidatesSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      detectedSourceLanguage: { type: "string" },
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            term: { type: "string" },
            aliases: {
              type: "array",
              items: { type: "string" }
            },
            meaning: { type: "string" },
            note: {
              anyOf: [{ type: "string" }, { type: "null" }]
            },
            category: {
              type: "string",
              enum: ["slang", "idiom", "address", "image", "reference", "phrase"]
            },
            confidence: {
              type: "string",
              enum: ["low", "medium", "high"]
            },
            lineOrders: {
              type: "array",
              items: { type: "number" }
            }
          },
          required: ["term", "aliases", "meaning", "note", "category", "confidence", "lineOrders"]
        }
      }
    },
    required: ["detectedSourceLanguage", "candidates"]
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
    "If lafzWorldModel is provided, treat it as a hard semantic map of the song: preserve speaker persona, addressee, power dynamics, imagery, and continuity rules.",
    "If verseState is provided for a line, treat it as a strong local-context signal for stance, target, and what the surrounding block is doing.",
    "If lineWorldModel is provided for a line, preserve its subject, action, target, social move, referents, and caution notes unless the lyric itself clearly contradicts them.",
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

export function buildWorldModelSystemPrompt(options: RequestAiWorldModelOptions) {
  return [
    "You are building the Lafz World Model, a hidden semantic map of the song before translation.",
    options.sourceLanguage
      ? `The source lyrics are in ${options.sourceLanguage}.`
      : "First infer the lyric language from the provided lines.",
    "These lyrics may be romanized Punjabi, Hindi, or Urdu written in Latin script.",
    "Do not translate the song here. Build a structured representation of what is happening in the song world.",
    "Infer the speaker persona, addressee, relationship frame, dominant conflict, narrative drive, motifs, symbols, and power dynamics conservatively.",
    "Build a compact entities list for the recurring people, groups, objects, symbols, or status markers that the song keeps returning to. Use stable entityKey values like narrator, lover, rivals, crew, money, car, chain, land when appropriate.",
    "Build a relationshipGraph that explains how important entities relate to one another, especially narrator-to-rival, narrator-to-lover, narrator-to-crew, and narrator-to-status-symbol dynamics when present.",
    "For each verse block, capture what scene or move is happening, who it is aimed at, which entities are active, what the interaction type is, what the stance is, and what continuity constraint the translator should preserve.",
    "For each line, capture who is acting, what they are doing, who it is directed at, what social move the line performs, what imagery is active, which entities the line touches, and any caution about mistranslating it.",
    "Do not invent plot details or biographical facts. Stay grounded in the lyric text, meaning lines, song context, glossary, and artist memory.",
    "If a referent or target is unclear, prefer null over guessing.",
    "Preserve the supplied groupIndex/startOrder/endOrder/order values exactly.",
    buildSharedContextHints(options, options.sourceLanguage),
    "Respond only with JSON matching the schema."
  ].join(" ");
}

export function buildSurfacePolishSystemPrompt(options: RequestAiSurfacePolishOptions) {
  return [
    "You are Lafz Surface Polish, a constrained English phrasing pass for lyric translations.",
    options.sourceLanguage
      ? `The source lyrics were originally in ${options.sourceLanguage}, and the current chosen lines are already translated into ${options.targetLanguage}.`
      : `The current chosen lines are already translated into ${options.targetLanguage}.`,
    "Your job is to improve surface fluency only when the meaning can stay intact.",
    "Do not change who is speaking, who is being addressed, what action is happening, the social move, or the emotional stance.",
    "Preserve every protectedAnchors entry exactly. If an anchor should stay raw or chant-like, keep it raw.",
    "Keep hook and chant energy when that is part of the line's identity. Do not over-smooth repeated slogan-like lines.",
    "safePolish should be a minimal, low-risk improvement. naturalPolish can be smoother, but it must still preserve the same semantic bones.",
    "If a line is already strong or any polish would risk drift, return the original chosen line for both safePolish and naturalPolish and set apply to false.",
    "Use songContext, lafzWorldModel, verseState, and lineWorldModel to preserve continuity and tone.",
    buildSharedContextHints(options, options.sourceLanguage),
    "Respond only with JSON matching the schema."
  ].join(" ");
}

export function buildSurfacePolishAuditSystemPrompt(options: RequestAiSurfacePolishAuditOptions) {
  return [
    "You are the Lafz Surface Polish semantic audit.",
    options.sourceLanguage
      ? `The source lyrics were originally in ${options.sourceLanguage}, and you must keep the approved English meaning intact.`
      : "You must keep the approved English meaning intact.",
    "Choose between original, safe, and natural.",
    "Only choose a polished option if it clearly improves English fluency without changing subject, action, target, social move, tone, imagery, or stance.",
    "Preserve every protectedAnchors entry exactly. If a polished option drops or alters an anchor, reject it.",
    "If naturalPolish is smoother but risks even slight semantic drift, prefer safePolish or original.",
    "If both polished options are risky, choose original.",
    "fluencyGain should describe whether the winner improves English phrasing over the original.",
    "semanticRisk should describe the risk of semantic drift in the winner itself.",
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

export function buildVocabularyCandidatesSystemPrompt(options: RequestAiVocabularyCandidatesOptions) {
  return [
    "You are the Lafz Vocabulary Agent discovery pass.",
    options.sourceLanguage
      ? `The source lyrics are in ${options.sourceLanguage}, and the final display language is ${options.targetLanguage}.`
      : `Infer the source language from the lyrics, then identify reusable vocabulary for future ${options.targetLanguage} translation.`,
    "Your job is to extract only source-language words or short phrases that are worth remembering across future songs.",
    "Focus on slang, idioms, short recurring phrases, address terms, cultural references, and compact source-language image words.",
    "Do not extract full lines, obvious plain-English words, generic names, or terms whose meaning is already obvious from English alone.",
    "Use the line meaning, impliedMeaning, chosen translation, song context, world model, and artist memory to infer a concise reusable meaning.",
    "Prefer candidates that are culturally loaded, artist-specific, repeated, or non-obvious to an English reader.",
    "If a candidate is already covered by existingTerms, only return it if this song gives meaningfully stronger evidence or a sharper meaning.",
    "Keep meanings short and reusable, not whole-line paraphrases.",
    "Return lineOrders using the exact order numbers from the input lines.",
    buildSharedContextHints(options, options.sourceLanguage),
    "Respond only with JSON matching the schema."
  ].join(" ");
}

export function buildWorldModelUserPrompt(options: RequestAiWorldModelOptions) {
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
      verses: options.verses,
      lines: options.lines
    },
    null,
    2
  );
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

export function buildVocabularyCandidatesUserPrompt(options: RequestAiVocabularyCandidatesOptions) {
  return JSON.stringify(
    {
      track: {
        title: options.title,
        artist: options.artist,
        album: options.album
      },
      sourceLanguage: options.sourceLanguage ?? "auto-detect from lyrics",
      targetLanguage: options.targetLanguage,
      existingTerms: options.existingTerms ?? [],
      songContext: options.songContext,
      worldModel: options.worldModel
        ? {
            summary: options.worldModel.summary,
            speakerPersona: options.worldModel.speakerPersona,
            addressee: options.worldModel.addressee,
            coreMotifs: options.worldModel.coreMotifs,
            recurringSymbols: options.worldModel.recurringSymbols
          }
        : null,
      artistMemory: serializeArtistMemoryForPrompt(options.artistMemory),
      lines: options.lines
    },
    null,
    2
  );
}

function compactSurfaceArtistMemory(artistMemory: AiArtistMemory | null) {
  if (!artistMemory) {
    return null;
  }

  return {
    personaSummary: artistMemory.personaSummary,
    translationPreferences: artistMemory.translationPreferences.slice(0, 4),
    translationDirectives: artistMemory.translationDirectives.slice(0, 6),
    recurringMotifs: artistMemory.recurringMotifs.slice(0, 5),
    stanceNotes: artistMemory.stanceNotes.slice(0, 4),
    perspectiveNotes: artistMemory.perspectiveNotes.slice(0, 4)
  };
}

function compactSurfaceWorldModel(worldModel: AiWorldModel | null) {
  if (!worldModel) {
    return null;
  }

  return {
    summary: worldModel.summary,
    speakerPersona: worldModel.speakerPersona,
    addressee: worldModel.addressee,
    narrativeDrive: worldModel.narrativeDrive,
    dominantConflict: worldModel.dominantConflict,
    coreMotifs: worldModel.coreMotifs.slice(0, 5),
    continuityRules: worldModel.continuityRules.slice(0, 6),
    entities: worldModel.entities.slice(0, 8).map((entity) => ({
      entityKey: entity.entityKey,
      label: entity.label,
      role: entity.role,
      salience: entity.salience
    })),
    relationshipGraph: worldModel.relationshipGraph.slice(0, 8).map((relationship) => ({
      sourceEntity: relationship.sourceEntity,
      targetEntity: relationship.targetEntity,
      dynamic: relationship.dynamic,
      powerBalance: relationship.powerBalance,
      confidence: relationship.confidence
    }))
  };
}

function compactSurfaceLineWorldModel(lineWorldModel: AiWorldModelLine | null | undefined) {
  if (!lineWorldModel) {
    return null;
  }

  return {
    subject: lineWorldModel.subject,
    action: lineWorldModel.action,
    target: lineWorldModel.target,
    socialMove: lineWorldModel.socialMove,
    emotionalColor: lineWorldModel.emotionalColor,
    hiddenMeaning: lineWorldModel.hiddenMeaning,
    referents: lineWorldModel.referents.slice(0, 5),
    imagery: lineWorldModel.imagery.slice(0, 4),
    entityLinks: lineWorldModel.entityLinks.slice(0, 5),
    caution: lineWorldModel.caution
  };
}

function compactSurfaceVerseState(verseState: AiVerseState | null | undefined) {
  if (!verseState) {
    return null;
  }

  return {
    summary: verseState.summary,
    stance: verseState.stance,
    target: verseState.target,
    dominantIntents: verseState.dominantIntents.slice(0, 4),
    tension: verseState.tension,
    caution: verseState.caution
  };
}

export function buildSurfacePolishUserPrompt(options: RequestAiSurfacePolishOptions) {
  return JSON.stringify(
    {
      track: {
        title: options.title,
        artist: options.artist,
        album: options.album
      },
      sourceLanguage: options.sourceLanguage ?? "auto-detected earlier",
      targetLanguage: options.targetLanguage,
      songContext: options.songContext
        ? {
            summary: options.songContext.summary,
            tone: options.songContext.tone,
            speaker: options.songContext.speaker,
            addressee: options.songContext.addressee,
            stance: options.songContext.stance,
            themes: options.songContext.themes.slice(0, 5)
          }
        : null,
      lafzWorldModel: compactSurfaceWorldModel(options.worldModel),
      artistSignal: compactSurfaceArtistMemory(options.artistMemory),
      lines: options.lines.map((line) => ({
        index: line.index,
        original: line.original,
        chosen: line.chosen,
        meaning: line.meaning,
        impliedMeaning: line.impliedMeaning ?? null,
        register: line.register ?? null,
        contextBefore: line.contextBefore ?? [],
        contextAfter: line.contextAfter ?? [],
        verseState: compactSurfaceVerseState(line.verseState),
        lineWorldModel: compactSurfaceLineWorldModel(line.lineWorldModel),
        protectedAnchors: line.protectedAnchors
      }))
    },
    null,
    2
  );
}

export function buildSurfacePolishAuditUserPrompt(options: RequestAiSurfacePolishAuditOptions) {
  return JSON.stringify(
    {
      track: {
        title: options.title,
        artist: options.artist,
        album: options.album
      },
      sourceLanguage: options.sourceLanguage ?? "auto-detected earlier",
      targetLanguage: options.targetLanguage,
      songContext: options.songContext
        ? {
            summary: options.songContext.summary,
            tone: options.songContext.tone,
            speaker: options.songContext.speaker,
            addressee: options.songContext.addressee,
            stance: options.songContext.stance
          }
        : null,
      lafzWorldModel: compactSurfaceWorldModel(options.worldModel),
      artistSignal: compactSurfaceArtistMemory(options.artistMemory),
      lines: options.lines.map((line) => ({
        index: line.index,
        original: line.original,
        originalChosen: line.originalChosen,
        safePolish: line.safePolish,
        naturalPolish: line.naturalPolish,
        meaning: line.meaning,
        impliedMeaning: line.impliedMeaning ?? null,
        register: line.register ?? null,
        verseState: compactSurfaceVerseState(line.verseState),
        lineWorldModel: compactSurfaceLineWorldModel(line.lineWorldModel),
        protectedAnchors: line.protectedAnchors
      }))
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
      lafzWorldModel: options.worldModel,
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
        ...(line.normalizationNotes?.length ? { normalizationNotes: line.normalizationNotes } : {}),
        meaning: line.meaning ?? null,
        impliedMeaning: line.impliedMeaning ?? null,
        register: line.register ?? null,
        contextBefore: line.contextBefore ?? [],
        contextAfter: line.contextAfter ?? [],
        groupIndex: line.groupIndex ?? null,
        groupText: line.groupText ?? null,
        verseState: line.verseState ?? null,
        lineWorldModel: line.lineWorldModel ?? null,
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
        ...(line.normalizationNotes?.length ? { normalizationNotes: line.normalizationNotes } : {}),
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

export async function requestOpenAiEmbeddings(input: string[]) {
  const normalizedInput = input.map((value) => value.trim()).filter(Boolean);

  if (normalizedInput.length === 0) {
    return [] as number[][];
  }

  const response = await fetch(`${getOpenAiBaseUrl()}/embeddings`, {
    method: "POST",
    headers: getOpenAiAuthHeaders(),
    signal: AbortSignal.timeout(OPENAI_REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: process.env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULT_OPENAI_EMBEDDING_MODEL,
      input: normalizedInput
    })
  });

  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(extractOpenAiErrorMessage(payload, `OpenAI embeddings failed with status ${response.status}.`));
  }

  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("OpenAI embeddings returned an invalid response shape.");
  }

  return payload.data.map((entry, index) => {
    if (!isRecord(entry) || !Array.isArray(entry.embedding)) {
      throw new Error(`OpenAI embeddings returned an invalid vector at index ${index}.`);
    }

    const vector = entry.embedding.filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    if (vector.length === 0) {
      throw new Error(`OpenAI embeddings returned an empty vector at index ${index}.`);
    }

    return vector;
  });
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

export function parseWorldModelResponse(
  parsed: unknown,
  expectedVerseCount: number,
  expectedLineCount: number,
  providerLabel: string
): { sourceLanguage: string; worldModel: AiWorldModel } {
  const detectedSourceLanguage = isRecord(parsed) ? asString(parsed.detectedSourceLanguage) : null;
  const summary = isRecord(parsed) ? asString(parsed.summary) : null;

  if (
    !isRecord(parsed) ||
    !detectedSourceLanguage ||
    !summary ||
    !Array.isArray(parsed.verseModels) ||
    !Array.isArray(parsed.lineModels) ||
    parsed.verseModels.length !== expectedVerseCount ||
    parsed.lineModels.length !== expectedLineCount
  ) {
    throw new Error(`${providerLabel} returned an invalid Lafz World Model shape.`);
  }

  const parseVerse = (value: unknown, index: number) => {
    if (!isRecord(value)) {
      throw new Error(`${providerLabel} returned a non-object world-model verse at index ${index}.`);
    }

    const groupIndex = typeof value.groupIndex === "number" ? value.groupIndex : null;
    const startOrder = typeof value.startOrder === "number" ? value.startOrder : null;
    const endOrder = typeof value.endOrder === "number" ? value.endOrder : null;
    const sceneSummary = asString(value.sceneSummary);

    if (groupIndex === null || startOrder === null || endOrder === null || !sceneSummary) {
      throw new Error(`${providerLabel} returned an invalid world-model verse at index ${index}.`);
    }

    return {
      groupIndex,
      startOrder,
      endOrder,
      sceneSummary,
      stance: normalizeNullableString(value.stance),
      target: normalizeNullableString(value.target),
      dominantIntents: parseStringArray(value.dominantIntents),
      tension: normalizeNullableString(value.tension),
      powerMove: normalizeNullableString(value.powerMove),
      continuityNote: normalizeNullableString(value.continuityNote),
      imagery: parseStringArray(value.imagery),
      activeEntities: parseStringArray(value.activeEntities),
      interactionType: normalizeNullableString(value.interactionType)
    };
  };

  const parseLine = (value: unknown, index: number) => {
    if (!isRecord(value)) {
      throw new Error(`${providerLabel} returned a non-object world-model line at index ${index}.`);
    }

    const order = typeof value.order === "number" ? value.order : null;

    if (order === null) {
      throw new Error(`${providerLabel} returned an invalid world-model line at index ${index}.`);
    }

    return {
      order,
      subject: normalizeNullableString(value.subject),
      action: normalizeNullableString(value.action),
      target: normalizeNullableString(value.target),
      socialMove: normalizeNullableString(value.socialMove),
      emotionalColor: normalizeNullableString(value.emotionalColor),
      hiddenMeaning: normalizeNullableString(value.hiddenMeaning),
      imagery: parseStringArray(value.imagery),
      referents: parseStringArray(value.referents),
      entityLinks: parseStringArray(value.entityLinks),
      caution: normalizeNullableString(value.caution)
    };
  };

  const parseEntity = (value: unknown, index: number) => {
    if (!isRecord(value)) {
      throw new Error(`${providerLabel} returned a non-object world-model entity at index ${index}.`);
    }

    const entityKey = asString(value.entityKey);
    const label = asString(value.label);
    const salience = value.salience === "low" || value.salience === "medium" || value.salience === "high" ? value.salience : null;

    if (!entityKey || !label || !salience) {
      throw new Error(`${providerLabel} returned an invalid world-model entity at index ${index}.`);
    }

    return {
      entityKey,
      label,
      role: normalizeNullableString(value.role),
      description: normalizeNullableString(value.description),
      aliases: parseStringArray(value.aliases),
      salience: salience as "low" | "medium" | "high"
    };
  };

  const parseRelationship = (value: unknown, index: number) => {
    if (!isRecord(value)) {
      throw new Error(`${providerLabel} returned a non-object world-model relationship at index ${index}.`);
    }

    const sourceEntity = asString(value.sourceEntity);
    const targetEntity = asString(value.targetEntity);
    const dynamic = asString(value.dynamic);
    const confidence =
      value.confidence === "low" || value.confidence === "medium" || value.confidence === "high"
        ? value.confidence
        : null;

    if (!sourceEntity || !targetEntity || !dynamic || !confidence) {
      throw new Error(`${providerLabel} returned an invalid world-model relationship at index ${index}.`);
    }

    return {
      sourceEntity,
      targetEntity,
      dynamic,
      powerBalance: normalizeNullableString(value.powerBalance),
      evidence: normalizeNullableString(value.evidence),
      confidence: confidence as "low" | "medium" | "high"
    };
  };

  return {
    sourceLanguage: detectedSourceLanguage,
    worldModel: {
      summary,
      speakerPersona: normalizeNullableString(parsed.speakerPersona),
      addressee: normalizeNullableString(parsed.addressee),
      narrativeDrive: normalizeNullableString(parsed.narrativeDrive),
      dominantConflict: normalizeNullableString(parsed.dominantConflict),
      relationshipFrame: normalizeNullableString(parsed.relationshipFrame),
      worldState: normalizeNullableString(parsed.worldState),
      coreMotifs: parseStringArray(parsed.coreMotifs),
      recurringSymbols: parseStringArray(parsed.recurringSymbols),
      powerDynamics: parseStringArray(parsed.powerDynamics),
      continuityRules: parseStringArray(parsed.continuityRules),
      entities: Array.isArray(parsed.entities) ? parsed.entities.map(parseEntity) : [],
      relationshipGraph: Array.isArray(parsed.relationshipGraph) ? parsed.relationshipGraph.map(parseRelationship) : [],
      verseModels: parsed.verseModels.map(parseVerse),
      lineModels: parsed.lineModels.map(parseLine)
    }
  };
}

export function parseSurfacePolishResponse(
  parsed: unknown,
  expectedLineCount: number,
  providerLabel: string
): {
  lines: Array<{
    apply: boolean;
    reason: string | null;
    safePolish: string;
    naturalPolish: string;
  }>;
} {
  if (!isRecord(parsed) || !Array.isArray(parsed.lines) || parsed.lines.length !== expectedLineCount) {
    throw new Error(`${providerLabel} returned an invalid Lafz Surface Polish shape.`);
  }

  return {
    lines: parsed.lines.map((line, index) => {
      if (!isRecord(line)) {
        throw new Error(`${providerLabel} returned a non-object surface-polish line at index ${index}.`);
      }

      const safePolish = asString(line.safePolish);
      const naturalPolish = asString(line.naturalPolish);

      if (typeof line.apply !== "boolean" || !safePolish || !naturalPolish) {
        throw new Error(`${providerLabel} returned an invalid surface-polish line at index ${index}.`);
      }

      return {
        apply: line.apply,
        reason: normalizeNullableString(line.reason),
        safePolish,
        naturalPolish
      };
    })
  };
}

export function parseSurfacePolishAuditResponse(
  parsed: unknown,
  expectedLineCount: number,
  providerLabel: string
): {
  lines: Array<{
    winner: "original" | "safe" | "natural";
    chosen: string;
    reason: string | null;
    fluencyGain: "none" | "minor" | "clear";
    semanticRisk: "low" | "medium" | "high";
  }>;
} {
  if (!isRecord(parsed) || !Array.isArray(parsed.lines) || parsed.lines.length !== expectedLineCount) {
    throw new Error(`${providerLabel} returned an invalid Lafz Surface Polish audit shape.`);
  }

  return {
    lines: parsed.lines.map((line, index) => {
      if (!isRecord(line)) {
        throw new Error(`${providerLabel} returned a non-object surface-polish audit line at index ${index}.`);
      }

      const winner =
        line.winner === "original" || line.winner === "safe" || line.winner === "natural"
          ? line.winner
          : null;
      const chosen = asString(line.chosen);
      const fluencyGain =
        line.fluencyGain === "none" || line.fluencyGain === "minor" || line.fluencyGain === "clear"
          ? line.fluencyGain
          : null;
      const semanticRisk =
        line.semanticRisk === "low" || line.semanticRisk === "medium" || line.semanticRisk === "high"
          ? line.semanticRisk
          : null;

      if (!winner || !chosen || !fluencyGain || !semanticRisk) {
        throw new Error(`${providerLabel} returned an invalid surface-polish audit line at index ${index}.`);
      }

      return {
        winner,
        chosen,
        reason: normalizeNullableString(line.reason),
        fluencyGain,
        semanticRisk
      };
    })
  };
}

export function parseVocabularyCandidatesResponse(
  parsed: unknown,
  providerLabel: string
): {
  sourceLanguage: string;
  candidates: Array<{
    term: string;
    aliases: string[];
    meaning: string;
    note: string | null;
    category: "slang" | "idiom" | "address" | "image" | "reference" | "phrase";
    confidence: "low" | "medium" | "high";
    lineOrders: number[];
  }>;
} {
  const detectedSourceLanguage = isRecord(parsed) ? asString(parsed.detectedSourceLanguage) : null;

  if (!isRecord(parsed) || !detectedSourceLanguage || !Array.isArray(parsed.candidates)) {
    throw new Error(`${providerLabel} returned an invalid vocabulary-candidate shape.`);
  }

  return {
    sourceLanguage: detectedSourceLanguage,
    candidates: parsed.candidates.map((candidate, index) => {
      if (!isRecord(candidate)) {
        throw new Error(`${providerLabel} returned a non-object vocabulary candidate at index ${index}.`);
      }

      const term = asString(candidate.term);
      const meaning = asString(candidate.meaning);
      const category =
        candidate.category === "slang" ||
        candidate.category === "idiom" ||
        candidate.category === "address" ||
        candidate.category === "image" ||
        candidate.category === "reference" ||
        candidate.category === "phrase"
          ? candidate.category
          : null;
      const confidence =
        candidate.confidence === "low" || candidate.confidence === "medium" || candidate.confidence === "high"
          ? candidate.confidence
          : null;
      const lineOrders = Array.isArray(candidate.lineOrders)
        ? candidate.lineOrders.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
        : [];

      if (!term || !meaning || !category || !confidence || lineOrders.length === 0) {
        throw new Error(`${providerLabel} returned an invalid vocabulary candidate at index ${index}.`);
      }

      return {
        term,
        aliases: parseStringArray(candidate.aliases),
        meaning,
        note: normalizeNullableString(candidate.note),
        category,
        confidence,
        lineOrders
      };
    })
  };
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

export async function requestOpenAiWorldModel(
  options: RequestAiWorldModelOptions
): Promise<{ model: string; sourceLanguage: string; worldModel: AiWorldModel }> {
  if (options.lines.length === 0) {
    throw new Error("No lyric lines were provided to the Lafz World Model builder.");
  }

  const model = await resolveOpenAiModel();
  const parsed = await callOpenAiJson<unknown>({
    model,
    schemaName: "lafz_world_model",
    schema: buildWorldModelSchema(options.verses.length, options.lines.length),
    systemPrompt: buildWorldModelSystemPrompt(options),
    userPrompt: buildWorldModelUserPrompt(options),
    errorLabel: "OpenAI Lafz World Model request"
  });
  const normalized = parseWorldModelResponse(parsed, options.verses.length, options.lines.length, "OpenAI");

  return {
    model,
    sourceLanguage: normalized.sourceLanguage,
    worldModel: normalized.worldModel
  };
}

export async function requestOpenAiSurfacePolish(
  options: RequestAiSurfacePolishOptions,
  usageSink?: { inputTokens: number; outputTokens: number }
): Promise<{
  model: string;
  lines: Array<{
    apply: boolean;
    reason: string | null;
    safePolish: string;
    naturalPolish: string;
  }>;
}> {
  if (options.lines.length === 0) {
    throw new Error("No lyric lines were provided to Lafz Surface Polish.");
  }

  const localSink = { inputTokens: 0, outputTokens: 0 };
  const model = await resolveOpenAiModel();
  const parsed = await callOpenAiJson<unknown>({
    model,
    schemaName: "lafz_surface_polish",
    schema: buildSurfacePolishSchema(options.lines.length),
    systemPrompt: buildSurfacePolishSystemPrompt(options),
    userPrompt: buildSurfacePolishUserPrompt(options),
    errorLabel: "OpenAI surface-polish request",
    usageSink: localSink
  });
  const normalized = parseSurfacePolishResponse(parsed, options.lines.length, "OpenAI");

  if (usageSink) {
    usageSink.inputTokens += localSink.inputTokens;
    usageSink.outputTokens += localSink.outputTokens;
  }

  return {
    model,
    lines: normalized.lines
  };
}

export async function requestOpenAiSurfacePolishAudit(
  options: RequestAiSurfacePolishAuditOptions,
  usageSink?: { inputTokens: number; outputTokens: number }
): Promise<{
  model: string;
  lines: Array<{
    winner: "original" | "safe" | "natural";
    chosen: string;
    reason: string | null;
    fluencyGain: "none" | "minor" | "clear";
    semanticRisk: "low" | "medium" | "high";
  }>;
}> {
  if (options.lines.length === 0) {
    throw new Error("No lyric lines were provided to the Lafz Surface Polish audit.");
  }

  const localSink = { inputTokens: 0, outputTokens: 0 };
  const model = await resolveOpenAiModel();
  const parsed = await callOpenAiJson<unknown>({
    model,
    schemaName: "lafz_surface_polish_audit",
    schema: buildSurfacePolishAuditSchema(options.lines.length),
    systemPrompt: buildSurfacePolishAuditSystemPrompt(options),
    userPrompt: buildSurfacePolishAuditUserPrompt(options),
    errorLabel: "OpenAI surface-polish audit request",
    usageSink: localSink
  });
  const normalized = parseSurfacePolishAuditResponse(parsed, options.lines.length, "OpenAI");

  if (usageSink) {
    usageSink.inputTokens += localSink.inputTokens;
    usageSink.outputTokens += localSink.outputTokens;
  }

  return {
    model,
    lines: normalized.lines
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

export async function requestOpenAiVocabularyCandidates(
  options: RequestAiVocabularyCandidatesOptions,
  usageSink?: { inputTokens: number; outputTokens: number }
): Promise<{
  model: string;
  sourceLanguage: string;
  candidates: Array<{
    term: string;
    aliases: string[];
    meaning: string;
    note: string | null;
    category: "slang" | "idiom" | "address" | "image" | "reference" | "phrase";
    confidence: "low" | "medium" | "high";
    lineOrders: number[];
  }>;
}> {
  if (options.lines.length === 0) {
    throw new Error("No lyric lines were provided to the Lafz Vocabulary Agent.");
  }

  const localSink = { inputTokens: 0, outputTokens: 0 };
  const model = await resolveOpenAiModel();
  const parsed = await callOpenAiJson<unknown>({
    model,
    schemaName: "lafz_vocabulary_candidates",
    schema: buildVocabularyCandidatesSchema(),
    systemPrompt: buildVocabularyCandidatesSystemPrompt(options),
    userPrompt: buildVocabularyCandidatesUserPrompt(options),
    errorLabel: "OpenAI vocabulary-candidate request",
    usageSink: localSink
  });
  const normalized = parseVocabularyCandidatesResponse(parsed, "OpenAI");

  if (usageSink) {
    usageSink.inputTokens += localSink.inputTokens;
    usageSink.outputTokens += localSink.outputTokens;
  }

  return {
    model,
    sourceLanguage: normalized.sourceLanguage,
    candidates: normalized.candidates
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
