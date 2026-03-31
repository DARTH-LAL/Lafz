export type LafzBrainNodeType =
  | "artist"
  | "song"
  | "term_surface"
  | "term_sense"
  | "phrase_pattern"
  | "rendering"
  | "language"
  | "script_form"
  | "motif"
  | "entity_type"
  | "entity_instance"
  | "relationship_type"
  | "symbol"
  | "persona_style"
  | "cultural_reference";

export type LafzBrainEdgeType =
  | "artist_recorded_song"
  | "artist_exhibits_motif"
  | "artist_has_persona_style"
  | "artist_uses_term_surface"
  | "artist_prefers_rendering"
  | "song_has_motif"
  | "song_contains_entity_instance"
  | "song_uses_symbol"
  | "song_uses_term_surface"
  | "term_surface_maps_to_term_sense"
  | "term_sense_prefers_rendering"
  | "entity_instance_is_type"
  | "entity_instance_related_to_entity_instance";

export type LafzBrainConfidence = "low" | "medium" | "high";

export type LafzBrainNodeRecord = {
  id: string;
  nodeType: LafzBrainNodeType;
  canonicalKey: string;
  displayLabel: string;
  aliases: string[];
  languageCode: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
  sourceConfidence: "ai_generated" | "human_verified" | "human_created";
  isActive: boolean;
  updatedAt: string | null;
};

export type LafzBrainEdgeRecord = {
  id: string;
  edgeKey: string;
  edgeType: LafzBrainEdgeType;
  sourceNodeId: string;
  targetNodeId: string;
  weight: number;
  metadata: Record<string, unknown>;
  sourceSongId: string | null;
  evidence: string | null;
  updatedAt: string | null;
};

export type LafzBrainRenderingHint = {
  term: string;
  meaning: string;
  note?: string;
  source: "brain_rendering" | "brain_term";
};

export type LafzBrainSymbolHint = {
  symbol: string;
  note?: string;
  frequency: number;
};

export type LafzBrainMemoryPack = {
  builtAt: string;
  artistKeys: string[];
  sourceSongIds: string[];
  styleHints: string[];
  motifHints: string[];
  relationshipPriors: string[];
  symbolHints: LafzBrainSymbolHint[];
  renderingHints: LafzBrainRenderingHint[];
};

export type LafzBrainMemoryPackCacheRecord = {
  cacheKey: string;
  payload: LafzBrainMemoryPack;
  updatedAt: string;
};
