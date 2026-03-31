import type { AiGlossaryEntry } from "@/features/ai/glossary";
import {
  buildDraftSchema,
  buildSystemPrompt,
  parseGeneratedLines
} from "@/features/ai/openai";
import type {
  AiArtistMemory,
  AiCorrectionHint,
  AiVerseState,
  AiWorldModel,
  AiWorldModelLine,
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
  worldModel: AiWorldModel | null;
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
    lineWorldModel?: AiWorldModelLine | null;
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

function trimStringArray(values: string[] | undefined, limit: number) {
  return (values ?? []).filter(Boolean).slice(0, limit);
}

function compactSongContext(songContext: RequestAnthropicTranslationDraftOptions["songContext"]) {
  if (!songContext) {
    return null;
  }

  return {
    summary: songContext.summary,
    tone: songContext.tone,
    speaker: songContext.speaker,
    addressee: songContext.addressee,
    stance: songContext.stance,
    themes: trimStringArray(songContext.themes, 4),
    notablePhrases: trimStringArray(songContext.notablePhrases, 4)
  };
}

function compactWorldModel(worldModel: AiWorldModel | null) {
  if (!worldModel) {
    return null;
  }

  return {
    summary: worldModel.summary,
    speakerPersona: worldModel.speakerPersona,
    addressee: worldModel.addressee,
    narrativeDrive: worldModel.narrativeDrive,
    dominantConflict: worldModel.dominantConflict,
    relationshipFrame: worldModel.relationshipFrame,
    worldState: worldModel.worldState,
    coreMotifs: trimStringArray(worldModel.coreMotifs, 6),
    recurringSymbols: trimStringArray(worldModel.recurringSymbols, 5),
    powerDynamics: trimStringArray(worldModel.powerDynamics, 5),
    continuityRules: trimStringArray(worldModel.continuityRules, 6),
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

function compactArtistMemory(artistMemory: AiArtistMemory | null) {
  if (!artistMemory) {
    return null;
  }

  return {
    displayName: artistMemory.displayName,
    personaSummary: artistMemory.personaSummary,
    translationDirectives: trimStringArray(artistMemory.translationDirectives, 8),
    translationPreferences: trimStringArray(artistMemory.translationPreferences, 5),
    recurringMotifs: trimStringArray(artistMemory.recurringMotifs, 6),
    voiceNotes: trimStringArray(artistMemory.voiceNotes, 4),
    stanceNotes: trimStringArray(artistMemory.stanceNotes, 4),
    perspectiveNotes: trimStringArray(artistMemory.perspectiveNotes, 4),
    canonicalRenderings: (artistMemory.canonicalRenderings ?? []).slice(0, 8).map((entry) => ({
      term: entry.term,
      rendering: entry.rendering
    }))
  };
}

function compactGlossary(glossaryEntries: AiGlossaryEntry[]) {
  return glossaryEntries.slice(0, 8).map((entry) => ({
    term: entry.term,
    meaning: entry.meaning,
    category: entry.category ?? null
  }));
}

function compactVerseState(verseState: AiVerseState | null | undefined) {
  if (!verseState) {
    return null;
  }

  return {
    summary: verseState.summary,
    stance: verseState.stance,
    target: verseState.target,
    dominantIntents: trimStringArray(verseState.dominantIntents, 4),
    tension: verseState.tension,
    caution: verseState.caution
  };
}

function compactLineWorldModel(lineWorldModel: AiWorldModelLine | null | undefined) {
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
    imagery: trimStringArray(lineWorldModel.imagery, 4),
    referents: trimStringArray(lineWorldModel.referents, 4),
    entityLinks: trimStringArray(lineWorldModel.entityLinks, 4),
    caution: lineWorldModel.caution
  };
}

function compactCorrections(matchingCorrections: AiCorrectionHint[] | undefined) {
  return (matchingCorrections ?? []).slice(0, 2).map((entry) => ({
    original: entry.original,
    chosen: entry.chosen,
    source: entry.source,
    similarity: entry.similarity,
    note: entry.note
  }));
}

function compactPreviousTranslation(previousTranslation: PreviousTranslationRef | null | undefined) {
  if (!previousTranslation) {
    return null;
  }

  if (!previousTranslation.manuallyReviewed && previousTranslation.confidence === "high") {
    return null;
  }

  return previousTranslation;
}

function buildAnthropicUserPrompt(options: RequestAnthropicTranslationDraftOptions) {
  return JSON.stringify(
    {
      track: {
        title: options.title,
        artist: options.artist,
        album: options.album
      },
      sourceLanguage: options.sourceLanguage ?? "auto-detect from lyrics",
      targetLanguage: options.targetLanguage,
      compactContext: {
        songContext: compactSongContext(options.songContext),
        lafzWorldModel: compactWorldModel(options.worldModel),
        artistMemory: compactArtistMemory(options.artistMemory),
        glossary: compactGlossary(options.glossaryEntries)
      },
      outputRules: {
        exactLineCount: options.lines.length,
        includeTransliteration: options.includeTransliteration,
        includeNotes: options.includeNotes
      },
      lines: options.lines.map((line) => ({
        index: line.index,
        original: line.original,
        ...(line.normalizedOriginal ? { normalizedOriginal: line.normalizedOriginal } : {}),
        ...(line.meaning ? { meaning: line.meaning } : {}),
        ...(line.impliedMeaning ? { impliedMeaning: line.impliedMeaning } : {}),
        ...(line.register ? { register: line.register } : {}),
        ...(line.contextBefore?.length ? { contextBefore: line.contextBefore } : {}),
        ...(line.contextAfter?.length ? { contextAfter: line.contextAfter } : {}),
        ...(typeof line.groupIndex === "number" ? { groupIndex: line.groupIndex } : {}),
        verseState: compactVerseState(line.verseState),
        lineWorldModel: compactLineWorldModel(line.lineWorldModel),
        matchingCorrections: compactCorrections(line.matchingCorrections),
        previousTranslation: compactPreviousTranslation(line.previousTranslation)
      }))
    },
    null,
    2
  );
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
    `The user payload is intentionally compacted for efficiency. Treat compactContext, verseState, and lineWorldModel as the highest-signal guidance. If compactContext.lafzWorldModel includes entities or relationshipGraph, preserve those entity roles and relationships in the English.\nRespond only with a JSON object matching this exact schema (exactly ${lineCount} lines):\n${schema}`
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
    userPrompt: buildAnthropicUserPrompt(options),
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
