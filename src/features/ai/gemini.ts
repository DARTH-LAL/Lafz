import type { AiGlossaryEntry } from "@/features/ai/glossary";
import { serializeArtistMemoryForPrompt } from "@/features/ai/artist-profile-format";
import type {
  AiArtistMemory,
  AiCorrectionHint,
  GeneratedTranslationLineDraft,
  PreviousTranslationRef,
  AiSongContext,
  AiVerseState,
  AiWorldModel,
  AiWorldModelLine
} from "@/features/ai/types";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildDraftSchema,
  parseGeneratedLines
} from "@/features/ai/openai";

const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_GEMINI_TRANSLATION_MODEL = "gemini-2.5-flash";
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
  verseState?: AiVerseState | null;
  lineWorldModel?: AiWorldModelLine | null;
  matchingCorrections?: AiCorrectionHint[];
  previousTranslation?: PreviousTranslationRef | null;
};

type RequestGeminiDraftComparisonOptions = {
  title: string;
  artist: string;
  album: string;
  sourceLanguage: string;
  targetLanguage: string;
  glossaryEntries: AiGlossaryEntry[];
  songContext: AiSongContext | null;
  worldModel: AiWorldModel | null;
  artistMemory: AiArtistMemory | null;
  lines: GeminiDraftComparisonLine[];
};

type GeminiCandidateScore = {
  semanticAccuracy: number;
  contextFit: number;
  perspectiveFidelity: number;
  repetitionRisk: number;
  driftRisk: number;
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

function normalizeScore(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(5, Math.round(value))) : null;
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
    "If lafzWorldModel is provided, treat it as the hidden semantic map of the song. Reject candidates that violate its speaker persona, addressee, conflict, power dynamics, imagery, continuity rules, entity roles, or relationshipGraph dynamics.",
    "Use verseState when provided to preserve the local block's stance, target, and escalation instead of treating every line as the same song-wide mood.",
    "Use lineWorldModel when provided to preserve who is acting, what social move the line performs, and what referents or imagery must survive into English.",
    "If a line includes previousTranslation, factor it in when evaluating — prefer consistency with previous high-confidence choices, prioritise meaningful improvement for low-confidence ones, and treat manually-reviewed choices as near-final unless a candidate clearly corrects an error.",
    "If both candidates are weak, choose the more conservative option or synthesize a conservative correction.",
    "Heavily penalize duplicated outputs for different original lines unless the original lyric itself is repeated.",
    "Heavily penalize ad-lib collapse: never reduce a meaningful lyric line to an ad-lib like 'uh-huh', 'yeah', or a tag.",
    "scoreA and scoreB must each rate semanticAccuracy, contextFit, perspectiveFidelity, repetitionRisk, and driftRisk on a 0-5 scale.",
    "Return only JSON with detectedSourceLanguage and lines. Each line must include winner, chosen, confidence, ambiguity, note, selectorReason, suspiciousDuplicate, adlibCollapseRisk, semanticDriftRisk, scoreA, and scoreB.",
    "winner must be one of: generator_a, generator_b, blended."
  ];

  if (options.artistMemory) {
    sharedHints.push(
      "Artist memory is provided in the request. Factor in the artist's translationPreferences, translationDirectives, and canonicalRenderings when selecting the best line. Preserve perspective fidelity: the winning line should sound true to the artist's persona, stance, and relationship dynamic, not just semantically correct."
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
      lafzWorldModel: options.worldModel,
      artistMemory: serializeArtistMemoryForPrompt(options.artistMemory),
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
  if (value && value.length > 0) return value;
  try {
    const { readSettingsSync } = require("@/features/settings/repository") as { readSettingsSync: () => { judgeModel: string } };
    const model = readSettingsSync().judgeModel;
    if (model) return model;
  } catch {}
  return DEFAULT_GEMINI_EVALUATOR_MODEL;
}

export async function resolveGeminiEvaluatorModel() {
  const value = process.env.GEMINI_EVALUATOR_MODEL?.trim();
  if (value && value.length > 0) return value;

  const { readSettings } = (await import("@/features/settings/repository")) as {
    readSettings: () => Promise<{ judgeModel: string }>;
  };
  const model = (await readSettings()).judgeModel;
  return model || DEFAULT_GEMINI_EVALUATOR_MODEL;
}

export async function resolveGeminiTranslationModel() {
  const value = process.env.GEMINI_TRANSLATION_MODEL?.trim();
  if (value && value.length > 0) return value;
  return DEFAULT_GEMINI_TRANSLATION_MODEL;
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
  temperature?: number;
  responseJsonSchema?: unknown;
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
          temperature: options.temperature ?? 0.2,
          responseMimeType: "application/json",
          ...(options.responseJsonSchema ? { responseJsonSchema: options.responseJsonSchema } : {})
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

type RequestGeminiTranslationDraftOptions = Parameters<typeof buildSystemPrompt>[0] & {
  draftVariant?: "generator_a" | "generator_b";
};

export async function requestGeminiTranslationDraft(
  options: RequestGeminiTranslationDraftOptions,
  usageSink?: { inputTokens: number; outputTokens: number }
): Promise<{
  model: string;
  sourceLanguage: string;
  lines: GeneratedTranslationLineDraft[];
  usage: { inputTokens: number; outputTokens: number };
}> {
  if (options.lines.length === 0) {
    throw new Error("No lyric lines were provided to the Gemini translation draft.");
  }

  const localSink = { inputTokens: 0, outputTokens: 0 };
  const model = await resolveGeminiTranslationModel();
  const parsed = await callGeminiJson<unknown>({
    model,
    systemPrompt: [
      options.draftVariant === "generator_b"
        ? "You are Generator B for Lafz. Prefer smoother, more natural English when it stays faithful."
        : "You are Generator A for Lafz. Prefer conservative, literal English that stays very close to the source.",
      buildSystemPrompt(options)
    ].join(" "),
    userPrompt: buildUserPrompt(options),
    errorLabel: `Gemini ${options.draftVariant === "generator_b" ? "generator B" : "generator A"} translation request`,
    usageSink: localSink,
    temperature: options.draftVariant === "generator_b" ? 0.32 : 0.16,
    responseJsonSchema: buildDraftSchema(options.lines.length)
  });
  const normalized = parseGeneratedLines(parsed, options.lines.length, "Gemini");

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
    suspiciousDuplicate: boolean;
    adlibCollapseRisk: boolean;
    semanticDriftRisk: boolean;
    scoreA: GeminiCandidateScore | null;
    scoreB: GeminiCandidateScore | null;
  }>;
  usage: { inputTokens: number; outputTokens: number };
}> {
  if (options.lines.length === 0) {
    throw new Error("No lyric lines were provided to the Gemini evaluator.");
  }

  const localSink = { inputTokens: 0, outputTokens: 0 };
  const model = await resolveGeminiEvaluatorModel();
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
        selectorReason: normalizeNullableString(line.selectorReason),
        suspiciousDuplicate: line.suspiciousDuplicate === true,
        adlibCollapseRisk: line.adlibCollapseRisk === true,
        semanticDriftRisk: line.semanticDriftRisk === true,
        scoreA: isRecord(line.scoreA)
          ? {
              semanticAccuracy: normalizeScore(line.scoreA.semanticAccuracy) ?? 0,
              contextFit: normalizeScore(line.scoreA.contextFit) ?? 0,
              perspectiveFidelity: normalizeScore(line.scoreA.perspectiveFidelity) ?? 0,
              repetitionRisk: normalizeScore(line.scoreA.repetitionRisk) ?? 0,
              driftRisk: normalizeScore(line.scoreA.driftRisk) ?? 0
            }
          : null,
        scoreB: isRecord(line.scoreB)
          ? {
              semanticAccuracy: normalizeScore(line.scoreB.semanticAccuracy) ?? 0,
              contextFit: normalizeScore(line.scoreB.contextFit) ?? 0,
              perspectiveFidelity: normalizeScore(line.scoreB.perspectiveFidelity) ?? 0,
              repetitionRisk: normalizeScore(line.scoreB.repetitionRisk) ?? 0,
              driftRisk: normalizeScore(line.scoreB.driftRisk) ?? 0
            }
          : null
      };
    }),
    usage: localSink
  };
}
