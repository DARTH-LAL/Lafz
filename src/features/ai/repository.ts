import {
  getCloudDataMetadata,
  isCloudStorageConfigurationError,
  listCloudDataObjects,
  listCloudDataKeys,
  readCloudDataJson,
  toCloudDataHint,
  writeCloudDataJson
} from "@/features/cloud/data-store";
import type {
  AiDraftLine,
  AiArtistMemory,
  AiSelectedSource,
  AiTranslationConfidence,
  AiTranslationDraftFile,
  AiTranslationDraftInspection,
  AiSongContext,
  AiVerseState,
  AiWorldEntity,
  AiWorldModel,
  AiWorldModelLine,
  AiWorldModelVerse,
  AiWorldRelationship
} from "@/features/ai/types";
import type { AiGlossaryEntry } from "@/features/ai/glossary";
import { getSupabaseServerClient } from "@/features/cloud/supabase";
import { normalizeLookupText as normalizeRomanizedLookupText } from "@/features/ai/romanized-normalization";
import type { TrackTranslation } from "@/features/translations/types";

const aiTranslationDraftsRoot = "data/translations/drafts";

type SupabaseDraftRecord = {
  draft: AiTranslationDraftFile;
  updatedAt: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asConfidence(value: unknown): AiTranslationConfidence | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

function asSelectedSource(value: unknown): AiSelectedSource | null {
  return value === "generator_a" || value === "generator_b" || value === "blended" ? value : null;
}

function normalizeLookupText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeArtistTokens(value: string) {
  return value
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/gi)
    .map((entry) => normalizeLookupText(entry))
    .filter(Boolean);
}

function scoreDraftMetadataMatch(
  draft: AiTranslationDraftFile,
  target: {
    title: string;
    artist: string;
    album?: string | null;
  }
) {
  const normalizedTitle = normalizeLookupText(target.title);
  const normalizedArtist = normalizeLookupText(target.artist);

  if (!normalizedTitle || normalizeLookupText(draft.title) !== normalizedTitle) {
    return null;
  }

  let score = 0;
  const draftArtist = normalizeLookupText(draft.artist);

  if (draftArtist === normalizedArtist) {
    score += 100;
  } else {
    const targetTokens = new Set(normalizeArtistTokens(target.artist));
    const overlap = normalizeArtistTokens(draft.artist).filter((token) => targetTokens.has(token)).length;

    if (overlap === 0) {
      return null;
    }

    score += overlap * 10;
  }

  if (target.album && normalizeLookupText(draft.album) === normalizeLookupText(target.album)) {
    score += 20;
  }

  return score;
}

function parseStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
}

function parseAiDraftLine(value: unknown, index: number): AiDraftLine {
  if (!isRecord(value)) {
    throw new Error(`AI draft line ${index} is not a JSON object.`);
  }

  const order = asNumber(value.order);
  const original = asString(value.original);
  const normalizedOriginal = asString(value.normalizedOriginal);
  const normalizationNotes = parseStringArray(value.normalizationNotes);
  const meaning = asString(value.meaning) ?? asString(value.literal) ?? asString(value.translated);
  const impliedMeaning =
    value.impliedMeaning === null ? null : typeof value.impliedMeaning === "string" ? value.impliedMeaning.trim() || null : null;
  const register =
    value.register === null ? null : typeof value.register === "string" ? value.register.trim() || null : null;
  const legacyTranslated = asString(value.translated);
  const literal = asString(value.literal) ?? legacyTranslated;
  const natural = asString(value.natural) ?? legacyTranslated;
  const slangAware = asString(value.slangAware) ?? natural ?? literal ?? legacyTranslated;
  const chosen = asString(value.chosen) ?? natural ?? literal ?? legacyTranslated;
  const transliteration =
    value.transliteration === null ? null : typeof value.transliteration === "string" ? value.transliteration.trim() || null : null;
  const note = value.note === null ? null : typeof value.note === "string" ? value.note.trim() || null : null;
  const ambiguity =
    value.ambiguity === null ? null : typeof value.ambiguity === "string" ? value.ambiguity.trim() || null : null;
  const confidence = asConfidence(value.confidence) ?? "medium";
  const selectorReason =
    value.selectorReason === null ? null : typeof value.selectorReason === "string" ? value.selectorReason.trim() || null : null;
  const selectionWinner = asSelectedSource(value.selectionWinner);
  const startMs = value.startMs === null ? null : asNumber(value.startMs);
  const endMs = value.endMs === null ? null : asNumber(value.endMs);

  if (order === null || !original || !chosen || !literal || !natural || !meaning) {
    throw new Error(`AI draft line ${index} is missing required Lafz AI fields.`);
  }

  const finalSlangAware = slangAware ?? natural ?? literal;

  return {
    order,
    original,
    normalizedOriginal: normalizedOriginal ?? normalizeRomanizedLookupText(original) ?? null,
    normalizationNotes,
    meaning,
    impliedMeaning,
    register,
    literal,
    natural,
    slangAware: finalSlangAware,
    chosen,
    transliteration,
    note,
    ambiguity,
    confidence,
    selectorReason,
    selectionWinner,
    startMs,
    endMs
  };
}

function parseSongContext(value: unknown): AiSongContext | null {
  if (!isRecord(value)) {
    return null;
  }

  const summary = asString(value.summary);
  const themes = Array.isArray(value.themes) ? value.themes.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry)) : [];
  const tone = asString(value.tone);
  const notablePhrases = Array.isArray(value.notablePhrases)
    ? value.notablePhrases.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  const speaker = asString(value.speaker);
  const addressee = asString(value.addressee);
  const stance = asString(value.stance);
  const narrativeMode = asString(value.narrativeMode);

  if (!summary || !tone) {
    return null;
  }

  return {
    summary,
    themes,
    tone,
    notablePhrases,
    speaker,
    addressee,
    stance,
    narrativeMode
  };
}

function parseVerseState(value: unknown): AiVerseState | null {
  if (!isRecord(value)) {
    return null;
  }

  const groupIndex = asNumber(value.groupIndex);
  const startOrder = asNumber(value.startOrder);
  const endOrder = asNumber(value.endOrder);
  const summary = asString(value.summary);
  const stance = asString(value.stance);
  const target = asString(value.target);
  const dominantIntents = parseStringArray(value.dominantIntents);
  const tension = asString(value.tension);
  const caution = asString(value.caution);

  if (groupIndex === null || startOrder === null || endOrder === null || !summary) {
    return null;
  }

  return {
    groupIndex,
    startOrder,
    endOrder,
    summary,
    stance,
    target,
    dominantIntents,
    tension,
    caution
  };
}

function parseWorldModelVerse(value: unknown): AiWorldModelVerse | null {
  if (!isRecord(value)) {
    return null;
  }

  const groupIndex = asNumber(value.groupIndex);
  const startOrder = asNumber(value.startOrder);
  const endOrder = asNumber(value.endOrder);
  const sceneSummary = asString(value.sceneSummary);
  const stance = asString(value.stance);
  const target = asString(value.target);
  const dominantIntents = parseStringArray(value.dominantIntents);
  const tension = asString(value.tension);
  const powerMove = asString(value.powerMove);
  const continuityNote = asString(value.continuityNote);
  const imagery = parseStringArray(value.imagery);
  const activeEntities = parseStringArray(value.activeEntities);
  const interactionType = asString(value.interactionType);

  if (groupIndex === null || startOrder === null || endOrder === null || !sceneSummary) {
    return null;
  }

  return {
    groupIndex,
    startOrder,
    endOrder,
    sceneSummary,
    stance,
    target,
    dominantIntents,
    tension,
    powerMove,
    continuityNote,
    imagery,
    activeEntities,
    interactionType
  };
}

function parseWorldModelLine(value: unknown): AiWorldModelLine | null {
  if (!isRecord(value)) {
    return null;
  }

  const order = asNumber(value.order);
  const subject = asString(value.subject);
  const action = asString(value.action);
  const target = asString(value.target);
  const socialMove = asString(value.socialMove);
  const emotionalColor = asString(value.emotionalColor);
  const hiddenMeaning = asString(value.hiddenMeaning);
  const imagery = parseStringArray(value.imagery);
  const referents = parseStringArray(value.referents);
  const entityLinks = parseStringArray(value.entityLinks);
  const caution = asString(value.caution);

  if (order === null) {
    return null;
  }

  return {
    order,
    subject,
    action,
    target,
    socialMove,
    emotionalColor,
    hiddenMeaning,
    imagery,
    referents,
    entityLinks,
    caution
  };
}

function parseWorldEntity(value: unknown): AiWorldEntity | null {
  if (!isRecord(value)) {
    return null;
  }

  const entityKey = asString(value.entityKey);
  const label = asString(value.label);
  const salience =
    value.salience === "low" || value.salience === "medium" || value.salience === "high" ? value.salience : null;

  if (!entityKey || !label || !salience) {
    return null;
  }

  return {
    entityKey,
    label,
    role: asString(value.role),
    description: asString(value.description),
    aliases: parseStringArray(value.aliases),
    salience
  };
}

function parseWorldRelationship(value: unknown): AiWorldRelationship | null {
  if (!isRecord(value)) {
    return null;
  }

  const sourceEntity = asString(value.sourceEntity);
  const targetEntity = asString(value.targetEntity);
  const dynamic = asString(value.dynamic);
  const confidence =
    value.confidence === "low" || value.confidence === "medium" || value.confidence === "high" ? value.confidence : null;

  if (!sourceEntity || !targetEntity || !dynamic || !confidence) {
    return null;
  }

  return {
    sourceEntity,
    targetEntity,
    dynamic,
    powerBalance: asString(value.powerBalance),
    evidence: asString(value.evidence),
    confidence
  };
}

function parseWorldModel(value: unknown): AiWorldModel | null {
  if (!isRecord(value)) {
    return null;
  }

  const summary = asString(value.summary);
  const speakerPersona = asString(value.speakerPersona);
  const addressee = asString(value.addressee);
  const narrativeDrive = asString(value.narrativeDrive);
  const dominantConflict = asString(value.dominantConflict);
  const relationshipFrame = asString(value.relationshipFrame);
  const worldState = asString(value.worldState);
  const coreMotifs = parseStringArray(value.coreMotifs);
  const recurringSymbols = parseStringArray(value.recurringSymbols);
  const powerDynamics = parseStringArray(value.powerDynamics);
  const continuityRules = parseStringArray(value.continuityRules);
  const entities = Array.isArray(value.entities)
    ? value.entities.map((entry) => parseWorldEntity(entry)).filter((entry): entry is AiWorldEntity => Boolean(entry))
    : [];
  const relationshipGraph = Array.isArray(value.relationshipGraph)
    ? value.relationshipGraph
        .map((entry) => parseWorldRelationship(entry))
        .filter((entry): entry is AiWorldRelationship => Boolean(entry))
    : [];
  const verseModels = Array.isArray(value.verseModels)
    ? value.verseModels.map((entry) => parseWorldModelVerse(entry)).filter((entry): entry is AiWorldModelVerse => Boolean(entry))
    : [];
  const lineModels = Array.isArray(value.lineModels)
    ? value.lineModels.map((entry) => parseWorldModelLine(entry)).filter((entry): entry is AiWorldModelLine => Boolean(entry))
    : [];

  if (!summary) {
    return null;
  }

  return {
    summary,
    speakerPersona,
    addressee,
    narrativeDrive,
    dominantConflict,
    relationshipFrame,
    worldState,
    coreMotifs,
    recurringSymbols,
    powerDynamics,
    continuityRules,
    entities,
    relationshipGraph,
    verseModels,
    lineModels
  };
}

function parseArtistMemory(value: unknown): AiArtistMemory | null {
  if (!isRecord(value)) {
    return null;
  }

  const artistKey = asString(value.artistKey);
  const displayName = asString(value.displayName);
  const personaSummary = asString(value.personaSummary);
  const translationPreferences = Array.isArray(value.translationPreferences)
    ? value.translationPreferences.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  const translationDirectives = Array.isArray(value.translationDirectives)
    ? value.translationDirectives.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  const recurringThemes = Array.isArray(value.recurringThemes)
    ? value.recurringThemes.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  const recurringMotifs = Array.isArray(value.recurringMotifs)
    ? value.recurringMotifs.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  const relationshipPatterns = Array.isArray(value.relationshipPatterns)
    ? value.relationshipPatterns.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  const toneNotes = Array.isArray(value.toneNotes)
    ? value.toneNotes.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  const voiceNotes = Array.isArray(value.voiceNotes)
    ? value.voiceNotes.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  const stanceNotes = Array.isArray(value.stanceNotes)
    ? value.stanceNotes.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  const perspectiveNotes = Array.isArray(value.perspectiveNotes)
    ? value.perspectiveNotes.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  const notes = Array.isArray(value.notes)
    ? value.notes.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  const glossaryEntries = Array.isArray(value.glossaryEntries)
    ? value.glossaryEntries
        .map((entry): AiGlossaryEntry | null => {
          if (!isRecord(entry)) {
            return null;
          }

          const term = asString(entry.term);
          const meaning = asString(entry.meaning);

          if (!term || !meaning) {
            return null;
          }

          const aliases = Array.isArray(entry.aliases)
            ? entry.aliases.map((alias) => asString(alias)).filter((alias): alias is string => Boolean(alias))
            : undefined;

          return {
            term,
            meaning,
            note: asString(entry.note) ?? undefined,
            aliases,
            category:
              entry.category === "entry" ||
              entry.category === "slang" ||
              entry.category === "idiom" ||
              entry.category === "phrase" ||
              entry.category === "reference" ||
              entry.category === "preferred_rendering"
                ? entry.category
                : undefined
          };
        })
        .filter((entry): entry is AiGlossaryEntry => Boolean(entry))
    : [];

  if (!artistKey || !displayName) {
    return null;
  }

  return {
    artistKey,
    displayName,
    personaSummary,
    translationPreferences,
    translationDirectives,
    recurringThemes,
    recurringMotifs,
    relationshipPatterns,
    toneNotes,
    voiceNotes,
    stanceNotes,
    perspectiveNotes,
    notes,
    glossaryEntries
  };
}

function parseAiTranslationDraftFile(value: unknown, filePath: string): AiTranslationDraftFile {
  if (!isRecord(value)) {
    throw new Error(`AI draft file ${filePath} is not a JSON object.`);
  }

  const spotifyTrackId = asString(value.spotifyTrackId);
  const title = asString(value.title);
  const artist = asString(value.artist);
  const album = asString(value.album);
  const durationMs = asNumber(value.durationMs);
  const sourceLanguage = asString(value.sourceLanguage);
  const targetLanguage = asString(value.targetLanguage);
  const generatedAt = asString(value.generatedAt);
  const mode = value.mode === "synced" || value.mode === "plain" ? value.mode : null;
  const sourceLyricsKind =
    value.sourceLyricsKind === "synced" || value.sourceLyricsKind === "plain" ? value.sourceLyricsKind : null;
  const songContext = parseSongContext(value.songContext);
  const worldModel = parseWorldModel(value.worldModel);
  const verseStates = Array.isArray(value.verseStates)
    ? value.verseStates.map((entry) => parseVerseState(entry)).filter((entry): entry is AiVerseState => Boolean(entry))
    : [];
  const artistMemory = parseArtistMemory(value.artistMemory);
  const generator = isRecord(value.generator) ? value.generator : null;
  const provider =
    generator?.provider === "openai" || generator?.provider === "ollama" || generator?.provider === "multi"
      ? "multi"
      : null;
  const model = asString(generator?.model);
  const lines = Array.isArray(value.lines) ? value.lines.map((line, index) => parseAiDraftLine(line, index)) : null;

  if (
    !spotifyTrackId ||
    !title ||
    !artist ||
    !album ||
    durationMs === null ||
    !sourceLanguage ||
    !targetLanguage ||
    !generatedAt ||
    !mode ||
    !sourceLyricsKind ||
    !provider ||
    !model ||
    !lines
  ) {
    throw new Error(`AI draft file ${filePath} is missing required Lafz AI fields.`);
  }

  return {
    spotifyTrackId,
    title,
    artist,
    album,
    durationMs,
    sourceLanguage,
    targetLanguage,
    generatedAt,
    mode,
    sourceLyricsKind,
    generator: {
      provider,
      model
    },
    songContext,
    worldModel,
    verseStates,
    artistMemory,
    lines
  };
}

async function readAiTranslationDraftRecordFromSupabase(spotifyTrackId: string): Promise<SupabaseDraftRecord | null> {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("translation_drafts")
    .select("spotify_track_id, draft_json, updated_at")
    .eq("spotify_track_id", spotifyTrackId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read AI draft ${spotifyTrackId} from Supabase.`, error);
    return null;
  }

  if (!data) {
    return null;
  }

  try {
    return {
      draft: parseAiTranslationDraftFile(data.draft_json, `supabase:translation_drafts/${spotifyTrackId}`),
      updatedAt: asString(data.updated_at)
    };
  } catch (error) {
    console.error(`Supabase AI draft ${spotifyTrackId} could not be parsed.`, error);
    return null;
  }
}

async function listAiTranslationDraftRecordsFromSupabase(): Promise<SupabaseDraftRecord[] | null> {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.from("translation_drafts").select("spotify_track_id, draft_json, updated_at");

  if (error) {
    console.error("Could not list AI drafts from Supabase.", error);
    return null;
  }

  const records: SupabaseDraftRecord[] = [];

  for (const row of data ?? []) {
    try {
      records.push({
        draft: parseAiTranslationDraftFile(row.draft_json, `supabase:translation_drafts/${row.spotify_track_id}`),
        updatedAt: asString(row.updated_at)
      });
    } catch (error) {
      console.error(`Supabase AI draft ${row.spotify_track_id} could not be parsed.`, error);
    }
  }

  return records;
}

function chunkTrackIds(trackIds: string[], size = 200) {
  const chunks: string[][] = [];

  for (let index = 0; index < trackIds.length; index += size) {
    chunks.push(trackIds.slice(index, index + size));
  }

  return chunks;
}

export async function batchInspectAiTranslationDraftFiles(trackIds: Iterable<string>): Promise<Map<string, AiTranslationDraftInspection>> {
  const uniqueTrackIds = [...new Set([...trackIds].filter(Boolean))];
  const inspections = new Map<string, AiTranslationDraftInspection>();

  if (uniqueTrackIds.length === 0) {
    return inspections;
  }

  const supabase = getSupabaseServerClient();

  if (supabase) {
    for (const chunk of chunkTrackIds(uniqueTrackIds)) {
      const { data, error } = await supabase
        .from("translation_drafts")
        .select("spotify_track_id, draft_json, updated_at")
        .in("spotify_track_id", chunk);

      if (error) {
        console.error("Could not batch inspect AI drafts from Supabase.", error);
        break;
      }

      for (const row of data ?? []) {
        try {
          const draft = parseAiTranslationDraftFile(row.draft_json, `supabase:translation_drafts/${row.spotify_track_id}`);
          inspections.set(
            row.spotify_track_id,
            buildDraftInspection(draft, {
              filePath: `supabase:translation_drafts/${row.spotify_track_id}`,
              lastModifiedAt: asString(row.updated_at)
            })
          );
        } catch (error) {
          console.error(`Supabase AI draft ${row.spotify_track_id} could not be parsed.`, error);
          inspections.set(row.spotify_track_id, {
            exists: true,
            filePath: `supabase:translation_drafts/${row.spotify_track_id}`,
            mode: "malformed",
            lineCount: 0,
            lowConfidenceCount: 0,
            mediumConfidenceCount: 0,
            highConfidenceCount: 0,
            manualReviewCount: 0,
            lastModifiedAt: asString(row.updated_at),
            sourceLanguage: null,
            targetLanguage: null,
            model: null,
            preview: null,
            parseError: error instanceof Error ? error.message : "Could not parse AI draft JSON."
          });
        }
      }
    }
  }

  const unresolvedTrackIds = uniqueTrackIds.filter((trackId) => !inspections.has(trackId));

  if (unresolvedTrackIds.length === 0) {
    return inspections;
  }

  const localObjects = await listCloudDataObjects(aiTranslationDraftsRoot);
  const objectByTrackId = new Map(
    localObjects
      .filter((item) => item.key.endsWith(".json"))
      .map((item) => [item.key.split("/").pop()?.replace(/\.json$/i, "") ?? "", item] as const)
  );

  await Promise.all(
    unresolvedTrackIds.map(async (trackId) => {
      const object = objectByTrackId.get(trackId);

      if (!object) {
        return;
      }

      try {
        const rawDraft = await readCloudDataJson<unknown>(object.key);

        if (!rawDraft) {
          return;
        }

        const parsedDraft = parseAiTranslationDraftFile(rawDraft, object.key);
        inspections.set(
          trackId,
          buildDraftInspection(parsedDraft, {
            filePath: toCloudDataHint(object.key),
            lastModifiedAt: object.lastModifiedAt
          })
        );
      } catch (error) {
        if (isCloudStorageConfigurationError(error)) {
          throw error;
        }

        inspections.set(trackId, {
          exists: true,
          filePath: toCloudDataHint(getAiTranslationDraftFilePath(trackId)),
          mode: "malformed",
          lineCount: 0,
          lowConfidenceCount: 0,
          mediumConfidenceCount: 0,
          highConfidenceCount: 0,
          manualReviewCount: 0,
          lastModifiedAt: object.lastModifiedAt,
          sourceLanguage: null,
          targetLanguage: null,
          model: null,
          preview: null,
          parseError: error instanceof Error ? error.message : "Could not parse AI draft JSON."
        });
      }
    })
  );

  return inspections;
}

async function readAiTranslationDraftFromSupabase(spotifyTrackId: string) {
  const record = await readAiTranslationDraftRecordFromSupabase(spotifyTrackId);
  return record?.draft ?? null;
}

async function writeAiTranslationDraftToSupabase(draftFile: AiTranslationDraftFile) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return;
  }

  const { error } = await supabase.from("translation_drafts").upsert(
    {
      spotify_track_id: draftFile.spotifyTrackId,
      source_language: draftFile.sourceLanguage,
      target_language: draftFile.targetLanguage,
      draft_json: draftFile,
      updated_at: new Date().toISOString()
    },
    {
      onConflict: "spotify_track_id"
    }
  );

  if (error) {
    console.error(`Could not write AI draft ${draftFile.spotifyTrackId} to Supabase.`, error);
  }
}

export function getAiTranslationDraftFilePath(spotifyTrackId: string) {
  return `${aiTranslationDraftsRoot}/${spotifyTrackId}.json`;
}

function buildDraftInspection(
  draftFile: AiTranslationDraftFile,
  options?: {
    filePath?: string;
    lastModifiedAt?: string | null;
  }
): AiTranslationDraftInspection {
  return {
    exists: true,
    filePath: options?.filePath ?? toCloudDataHint(getAiTranslationDraftFilePath(draftFile.spotifyTrackId)),
    mode: draftFile.mode,
    lineCount: draftFile.lines.length,
    lowConfidenceCount: draftFile.lines.filter((line) => line.confidence === "low").length,
    mediumConfidenceCount: draftFile.lines.filter((line) => line.confidence === "medium").length,
    highConfidenceCount: draftFile.lines.filter((line) => line.confidence === "high").length,
    manualReviewCount: draftFile.lines.filter((line) => line.selectorReason === "Manually reviewed in Lafz.").length,
    lastModifiedAt: options?.lastModifiedAt ?? null,
    sourceLanguage: draftFile.sourceLanguage,
    targetLanguage: draftFile.targetLanguage,
    model: draftFile.generator.model,
    preview: JSON.stringify(draftFile, null, 2),
    parseError: null
  };
}

export async function writeAiTranslationDraftFile(draftFile: AiTranslationDraftFile) {
  const filePath = getAiTranslationDraftFilePath(draftFile.spotifyTrackId);

  // Snapshot the existing draft before overwriting
  const { backupDraftBeforeOverwrite } = await import("@/features/ai/versioning");
  await backupDraftBeforeOverwrite(draftFile.spotifyTrackId, filePath);

  await writeCloudDataJson(filePath, draftFile);
  await writeAiTranslationDraftToSupabase(draftFile);
  return toCloudDataHint(filePath);
}

export async function inspectAiTranslationDraftFile(spotifyTrackId: string): Promise<AiTranslationDraftInspection> {
  const filePath = getAiTranslationDraftFilePath(spotifyTrackId);

  try {
    const supabaseRecord = await readAiTranslationDraftRecordFromSupabase(spotifyTrackId);

    if (supabaseRecord) {
      return buildDraftInspection(supabaseRecord.draft, {
        filePath: `supabase:translation_drafts/${spotifyTrackId}`,
        lastModifiedAt: supabaseRecord.updatedAt
      });
    }

    const [rawDraft, fileMeta] = await Promise.all([
      readCloudDataJson<unknown>(filePath),
      getCloudDataMetadata(filePath)
    ]);

    if (!rawDraft) {
      return {
        exists: false,
        filePath: toCloudDataHint(filePath),
        mode: "missing",
        lineCount: 0,
        lowConfidenceCount: 0,
        mediumConfidenceCount: 0,
        highConfidenceCount: 0,
        manualReviewCount: 0,
        lastModifiedAt: null,
        sourceLanguage: null,
        targetLanguage: null,
        model: null,
        preview: null,
        parseError: null
      };
    }

    try {
      const parsedDraftFile = parseAiTranslationDraftFile(rawDraft, filePath);
      return buildDraftInspection(parsedDraftFile, {
        filePath: toCloudDataHint(filePath),
        lastModifiedAt: fileMeta?.lastModifiedAt ?? null
      });
    } catch (error) {
      return {
        exists: true,
        filePath: toCloudDataHint(filePath),
        mode: "malformed",
        lineCount: 0,
        lowConfidenceCount: 0,
        mediumConfidenceCount: 0,
        highConfidenceCount: 0,
        manualReviewCount: 0,
        lastModifiedAt: fileMeta?.lastModifiedAt ?? null,
        sourceLanguage: null,
        targetLanguage: null,
        model: null,
        preview: JSON.stringify(rawDraft, null, 2),
        parseError: error instanceof Error ? error.message : "Could not parse AI draft JSON."
      };
    }
  } catch (error) {
    if (isCloudStorageConfigurationError(error)) {
      throw error;
    }

    return {
      exists: true,
      filePath: toCloudDataHint(filePath),
      mode: "malformed",
      lineCount: 0,
      lowConfidenceCount: 0,
      mediumConfidenceCount: 0,
      highConfidenceCount: 0,
      manualReviewCount: 0,
      lastModifiedAt: null,
      sourceLanguage: null,
      targetLanguage: null,
      model: null,
      preview: null,
      parseError: error instanceof Error ? error.message : "Could not parse AI draft JSON."
    };
  }
}

export async function getAiTranslationDraftByTrackId(spotifyTrackId: string) {
  const cloudDraft = await readAiTranslationDraftFromSupabase(spotifyTrackId);

  if (cloudDraft) {
    return cloudDraft;
  }

  const filePath = getAiTranslationDraftFilePath(spotifyTrackId);
  const rawDraft = await readCloudDataJson<unknown>(filePath);
  return rawDraft ? parseAiTranslationDraftFile(rawDraft, filePath) : null;
}

export async function findAiTranslationDraftByMetadata(target: { title: string; artist: string; album?: string | null }) {
  const supabaseDrafts = await listAiTranslationDraftRecordsFromSupabase();

  if (supabaseDrafts && supabaseDrafts.length > 0) {
    let bestSupabaseMatch: {
      score: number;
      draft: AiTranslationDraftFile;
    } | null = null;

    for (const record of supabaseDrafts) {
      const score = scoreDraftMetadataMatch(record.draft, target);

      if (score !== null && (!bestSupabaseMatch || score > bestSupabaseMatch.score)) {
        bestSupabaseMatch = {
          score,
          draft: record.draft
        };
      }
    }

    if (bestSupabaseMatch) {
      return bestSupabaseMatch.draft;
    }
  }

  const fileKeys = (await listCloudDataKeys(aiTranslationDraftsRoot)).filter((fileName) => fileName.endsWith(".json"));

  let bestMatch: {
    score: number;
    draft: AiTranslationDraftFile;
  } | null = null;

  for (const filePath of fileKeys) {
    const rawDraft = await readCloudDataJson<unknown>(filePath);
    if (!rawDraft) {
      continue;
    }
    const parsedDraft = parseAiTranslationDraftFile(rawDraft, filePath);
    const score = scoreDraftMetadataMatch(parsedDraft, target);

    if (score !== null && (!bestMatch || score > bestMatch.score)) {
      bestMatch = {
        score,
        draft: parsedDraft
      };
    }
  }

  return bestMatch?.draft ?? null;
}

export async function listAiTranslationDraftsByArtistKey(artistKey: string) {
  const supabaseDrafts = await listAiTranslationDraftRecordsFromSupabase();
  const normalizedArtistKey = normalizeLookupText(artistKey.replace(/-/g, " "));
  if (supabaseDrafts) {
    const drafts = supabaseDrafts
      .map((record) => record.draft)
      .filter((draft) => normalizeArtistTokens(draft.artist).includes(normalizedArtistKey));

    if (drafts.length > 0) {
      return drafts.sort((left, right) => new Date(right.generatedAt).getTime() - new Date(left.generatedAt).getTime());
    }
  }

  const fileKeys = (await listCloudDataKeys(aiTranslationDraftsRoot)).filter((fileName) => fileName.endsWith(".json"));
  const drafts: AiTranslationDraftFile[] = [];

  for (const filePath of fileKeys) {
    try {
      const rawDraft = await readCloudDataJson<unknown>(filePath);
      if (!rawDraft) {
        continue;
      }
      const parsedDraft = parseAiTranslationDraftFile(rawDraft, filePath);
      const artistTokens = normalizeArtistTokens(parsedDraft.artist);

      if (artistTokens.includes(normalizedArtistKey)) {
        drafts.push(parsedDraft);
      }
    } catch (error) {
      if (isCloudStorageConfigurationError(error)) {
        throw error;
      }
      continue;
    }
  }

  return drafts.sort((left, right) => new Date(right.generatedAt).getTime() - new Date(left.generatedAt).getTime());
}

export function buildTrackTranslationFromAiDraft(draft: AiTranslationDraftFile): TrackTranslation | null {
  if (draft.mode !== "synced") {
    return null;
  }

  const syncedLines = draft.lines.filter(
    (line): line is typeof line & { startMs: number; endMs: number } =>
      typeof line.startMs === "number" && typeof line.endMs === "number"
  );

  if (syncedLines.length === 0) {
    return null;
  }

  return {
    spotifyTrackId: draft.spotifyTrackId,
    title: draft.title,
    artist: draft.artist,
    sourceLanguage: draft.sourceLanguage,
    targetLanguage: draft.targetLanguage,
    lines: syncedLines.map((line) => ({
      startMs: line.startMs,
      endMs: line.endMs,
      original: line.original,
      translated: line.chosen,
      transliteration: line.transliteration ?? undefined,
      note: line.note ?? undefined
    }))
  };
}
