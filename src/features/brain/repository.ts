import { getSupabaseServerClient } from "@/features/cloud/supabase";
import type {
  LafzBrainEdgeRecord,
  LafzBrainEdgeType,
  LafzBrainMemoryPack,
  LafzBrainMemoryPackCacheRecord,
  LafzBrainNodeRecord,
  LafzBrainNodeType
} from "@/features/brain/types";

type UnknownRecord = Record<string, unknown>;

type UpsertBrainNodeInput = {
  nodeType: LafzBrainNodeType;
  canonicalKey: string;
  displayLabel: string;
  aliases?: string[];
  languageCode?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  sourceConfidence?: LafzBrainNodeRecord["sourceConfidence"];
  embedding?: number[] | null;
};

type UpsertBrainEdgeInput = {
  edgeKey: string;
  edgeType: LafzBrainEdgeType;
  sourceNodeId: string;
  targetNodeId: string;
  weight?: number;
  metadata?: Record<string, unknown>;
  sourceSongId?: string | null;
  evidence?: string | null;
};

type UpsertSongWorldModelInput = {
  songNodeId: string;
  spotifyTrackId: string;
  title: string | null;
  artist: string | null;
  artistKeys: string[];
  sourceLanguage: string | null;
  summary: string | null;
  speakerPersona: string | null;
  addressee: string | null;
  narrativeDrive: string | null;
  dominantConflict: string | null;
  worldState: string | null;
  coreMotifs: string[];
  recurringSymbols: string[];
  continuityRules: string[];
  entitiesJson: unknown;
  relationshipsJson: unknown;
  verseModelsJson: unknown;
  lineModelsJson: unknown;
  modelId: string | null;
  generatedAt: string;
};

export type BrainSongWorldModelRecord = {
  songNodeId: string;
  spotifyTrackId: string;
  title: string | null;
  artist: string | null;
  artistKeys: string[];
  summary: string | null;
  speakerPersona: string | null;
  addressee: string | null;
  narrativeDrive: string | null;
  dominantConflict: string | null;
  worldState: string | null;
  coreMotifs: string[];
  recurringSymbols: string[];
  continuityRules: string[];
  relationshipsJson: unknown;
  updatedAt: string | null;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asEmbedding(value: unknown) {
  if (Array.isArray(value)) {
    const numbers = value.filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry));
    return numbers.length > 0 ? numbers : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed);
      return asEmbedding(parsed);
    } catch {
      return null;
    }
  }

  return null;
}

function isBrainSchemaMissingError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? asString((error as { code?: unknown }).code) : null;
  const message = "message" in error ? asString((error as { message?: unknown }).message) : null;

  return Boolean(
    code === "42P01" ||
      code === "PGRST205" ||
      code === "PGRST204" ||
      message?.includes("relation") ||
      message?.includes("schema cache") ||
      message?.includes("Could not find the table")
  );
}

function logBrainError(action: string, error: unknown) {
  if (isBrainSchemaMissingError(error)) {
    return;
  }

  console.error(`[lafz-brain] ${action} failed.`, error);
}

function parseBrainNodeRow(row: unknown): LafzBrainNodeRecord | null {
  if (!isRecord(row)) {
    return null;
  }

  const id = asString(row.id);
  const nodeType = asString(row.node_type) as LafzBrainNodeType | null;
  const canonicalKey = asString(row.canonical_key);
  const displayLabel = asString(row.display_label);

  if (!id || !nodeType || !canonicalKey || !displayLabel) {
    return null;
  }

  return {
    id,
    nodeType,
    canonicalKey,
    displayLabel,
    aliases: asStringArray(row.aliases),
    languageCode: asString(row.language_code),
    description: asString(row.description),
    metadata: isRecord(row.metadata) ? row.metadata : {},
    sourceConfidence: (asString(row.source_confidence) as LafzBrainNodeRecord["sourceConfidence"] | null) ?? "ai_generated",
    isActive: row.is_active !== false,
    embedding: asEmbedding(row.embedding),
    updatedAt: asString(row.updated_at)
  };
}

function parseBrainEdgeRow(row: unknown): LafzBrainEdgeRecord | null {
  if (!isRecord(row)) {
    return null;
  }

  const id = asString(row.id);
  const edgeKey = asString(row.edge_key);
  const edgeType = asString(row.edge_type) as LafzBrainEdgeType | null;
  const sourceNodeId = asString(row.source_node_id);
  const targetNodeId = asString(row.target_node_id);

  if (!id || !edgeKey || !edgeType || !sourceNodeId || !targetNodeId) {
    return null;
  }

  return {
    id,
    edgeKey,
    edgeType,
    sourceNodeId,
    targetNodeId,
    weight: asNumber(row.weight, 0.5),
    metadata: isRecord(row.metadata) ? row.metadata : {},
    sourceSongId: asString(row.source_song_id),
    evidence: asString(row.evidence),
    updatedAt: asString(row.updated_at)
  };
}

function parseSongWorldModelRow(row: unknown): BrainSongWorldModelRecord | null {
  if (!isRecord(row)) {
    return null;
  }

  const songNodeId = asString(row.song_node_id);
  const spotifyTrackId = asString(row.spotify_track_id);

  if (!songNodeId || !spotifyTrackId) {
    return null;
  }

  return {
    songNodeId,
    spotifyTrackId,
    title: asString(row.title),
    artist: asString(row.artist),
    artistKeys: asStringArray(row.artist_keys),
    summary: asString(row.summary),
    speakerPersona: asString(row.speaker_persona),
    addressee: asString(row.addressee),
    narrativeDrive: asString(row.narrative_drive),
    dominantConflict: asString(row.dominant_conflict),
    worldState: asString(row.world_state),
    coreMotifs: asStringArray(row.core_motifs),
    recurringSymbols: asStringArray(row.recurring_symbols),
    continuityRules: asStringArray(row.continuity_rules),
    relationshipsJson: row.relationships_json ?? null,
    updatedAt: asString(row.updated_at)
  };
}

export function isBrainConfigured() {
  return Boolean(getSupabaseServerClient());
}

export async function readBrainNodeByTypeAndKey(nodeType: LafzBrainNodeType, canonicalKey: string) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("kg_nodes")
    .select("*")
    .eq("node_type", nodeType)
    .eq("canonical_key", canonicalKey)
    .maybeSingle();

  if (error) {
    logBrainError(`read node ${nodeType}:${canonicalKey}`, error);
    return null;
  }

  return parseBrainNodeRow(data);
}

export async function listBrainNodesByTypeAndKeys(nodeType: LafzBrainNodeType, canonicalKeys: string[]) {
  const supabase = getSupabaseServerClient();

  if (!supabase || canonicalKeys.length === 0) {
    return [] as LafzBrainNodeRecord[];
  }

  const { data, error } = await supabase
    .from("kg_nodes")
    .select("*")
    .eq("node_type", nodeType)
    .in("canonical_key", canonicalKeys);

  if (error) {
    logBrainError(`list nodes ${nodeType}`, error);
    return [];
  }

  return (data ?? []).map(parseBrainNodeRow).filter((row): row is LafzBrainNodeRecord => Boolean(row));
}

export async function readBrainNodesByIds(nodeIds: string[]) {
  const supabase = getSupabaseServerClient();

  if (!supabase || nodeIds.length === 0) {
    return [] as LafzBrainNodeRecord[];
  }

  const { data, error } = await supabase.from("kg_nodes").select("*").in("id", nodeIds);

  if (error) {
    logBrainError("read nodes by ids", error);
    return [];
  }

  return (data ?? []).map(parseBrainNodeRow).filter((row): row is LafzBrainNodeRecord => Boolean(row));
}

export async function listBrainEdgesBySourceNodeIds(sourceNodeIds: string[], edgeTypes?: LafzBrainEdgeType[]) {
  const supabase = getSupabaseServerClient();

  if (!supabase || sourceNodeIds.length === 0) {
    return [] as LafzBrainEdgeRecord[];
  }

  let query = supabase.from("kg_edges").select("*").in("source_node_id", sourceNodeIds).eq("is_active", true);

  if (edgeTypes && edgeTypes.length > 0) {
    query = query.in("edge_type", edgeTypes);
  }

  const { data, error } = await query;

  if (error) {
    logBrainError("list edges by source ids", error);
    return [];
  }

  return (data ?? []).map(parseBrainEdgeRow).filter((row): row is LafzBrainEdgeRecord => Boolean(row));
}

export async function upsertBrainNode(input: UpsertBrainNodeInput) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("kg_nodes")
    .upsert(
      {
        node_type: input.nodeType,
        canonical_key: input.canonicalKey,
        display_label: input.displayLabel,
        aliases: input.aliases ?? [],
        language_code: input.languageCode ?? null,
        description: input.description ?? null,
        metadata: input.metadata ?? {},
        source_confidence: input.sourceConfidence ?? "ai_generated",
        embedding: input.embedding ?? null,
        is_active: true,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "node_type,canonical_key"
      }
    )
    .select("*")
    .single();

  if (error) {
    logBrainError(`upsert node ${input.nodeType}:${input.canonicalKey}`, error);
    return null;
  }

  return parseBrainNodeRow(data);
}

export async function updateBrainNodeEmbedding(nodeId: string, embedding: number[]) {
  const supabase = getSupabaseServerClient();

  if (!supabase || !nodeId || embedding.length === 0) {
    return false;
  }

  const { error } = await supabase
    .from("kg_nodes")
    .update({
      embedding,
      updated_at: new Date().toISOString()
    })
    .eq("id", nodeId);

  if (error) {
    logBrainError(`update node embedding ${nodeId}`, error);
    return false;
  }

  return true;
}

export async function upsertBrainEdge(input: UpsertBrainEdgeInput) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("kg_edges")
    .upsert(
      {
        edge_key: input.edgeKey,
        edge_type: input.edgeType,
        source_node_id: input.sourceNodeId,
        target_node_id: input.targetNodeId,
        weight: input.weight ?? 0.5,
        metadata: input.metadata ?? {},
        source_song_id: input.sourceSongId ?? null,
        evidence: input.evidence ?? null,
        is_active: true,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "edge_key"
      }
    )
    .select("*")
    .single();

  if (error) {
    logBrainError(`upsert edge ${input.edgeType}`, error);
    return null;
  }

  return parseBrainEdgeRow(data);
}

export async function upsertSongWorldModel(input: UpsertSongWorldModelInput) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("song_world_models")
    .upsert(
      {
        song_node_id: input.songNodeId,
        spotify_track_id: input.spotifyTrackId,
        title: input.title,
        artist: input.artist,
        artist_keys: input.artistKeys,
        source_language: input.sourceLanguage,
        summary: input.summary,
        speaker_persona: input.speakerPersona,
        addressee: input.addressee,
        narrative_drive: input.narrativeDrive,
        dominant_conflict: input.dominantConflict,
        world_state: input.worldState,
        core_motifs: input.coreMotifs,
        recurring_symbols: input.recurringSymbols,
        continuity_rules: input.continuityRules,
        entities_json: input.entitiesJson,
        relationships_json: input.relationshipsJson,
        verse_models_json: input.verseModelsJson,
        line_models_json: input.lineModelsJson,
        model_id: input.modelId,
        generated_at: input.generatedAt,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "spotify_track_id"
      }
    )
    .select("*")
    .single();

  if (error) {
    logBrainError(`upsert song world model ${input.spotifyTrackId}`, error);
    return null;
  }

  return parseSongWorldModelRow(data);
}

export async function readSongWorldModelsBySongNodeIds(songNodeIds: string[], limit = 20) {
  const supabase = getSupabaseServerClient();

  if (!supabase || songNodeIds.length === 0) {
    return [] as BrainSongWorldModelRecord[];
  }

  const { data, error } = await supabase
    .from("song_world_models")
    .select("*")
    .in("song_node_id", songNodeIds)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    logBrainError("read song world models by song ids", error);
    return [];
  }

  return (data ?? []).map(parseSongWorldModelRow).filter((row): row is BrainSongWorldModelRecord => Boolean(row));
}

export async function readSongWorldModelByTrackId(spotifyTrackId: string) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("song_world_models")
    .select("*")
    .eq("spotify_track_id", spotifyTrackId)
    .maybeSingle();

  if (error) {
    logBrainError(`read song world model ${spotifyTrackId}`, error);
    return null;
  }

  return parseSongWorldModelRow(data);
}

export async function readMemoryPackCache(cacheKey: string) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.from("memory_pack_cache").select("*").eq("cache_key", cacheKey).maybeSingle();

  if (error) {
    logBrainError(`read memory pack cache ${cacheKey}`, error);
    return null;
  }

  if (!isRecord(data) || !isRecord(data.payload_json)) {
    return null;
  }

  return {
    cacheKey,
    payload: data.payload_json as LafzBrainMemoryPack,
    updatedAt: asString(data.updated_at) ?? new Date(0).toISOString(),
    version:
      asNumber(data.version, 0) ||
      asNumber((data.payload_json as { audit?: { retrievalVersion?: unknown } })?.audit?.retrievalVersion, 1)
  } satisfies LafzBrainMemoryPackCacheRecord;
}

export async function writeMemoryPackCache(record: LafzBrainMemoryPackCacheRecord) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return;
  }

  const { error } = await supabase.from("memory_pack_cache").upsert(
    {
      cache_key: record.cacheKey,
      pack_type: "translation",
      scope_type: "song",
      scope_key: record.cacheKey,
      payload_json: record.payload,
      version:
        record.version ||
        asNumber((record.payload as { audit?: { retrievalVersion?: unknown } })?.audit?.retrievalVersion, 1),
      updated_at: record.updatedAt
    },
    {
      onConflict: "cache_key"
    }
  );

  if (error) {
    logBrainError(`write memory pack cache ${record.cacheKey}`, error);
  }
}

export async function linkArtistProfileNode(artistKey: string, nodeId: string) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return;
  }

  const { error } = await supabase.from("artist_profiles").update({ kg_node_id: nodeId }).eq("artist_key", artistKey);

  if (error) {
    logBrainError(`link artist profile ${artistKey}`, error);
  }
}
