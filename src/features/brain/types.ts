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

export type LafzBrainKnowledgeScope = "canonical" | "artist_local" | "song_local";

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
  embedding: number[] | null;
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

export type LafzBrainTextHint = {
  value: string;
  score: number;
  confidence: LafzBrainConfidence;
  reasons: string[];
  sourceSongIds: string[];
  sourceNodeIds: string[];
};

export type LafzBrainRenderingHint = {
  term: string;
  meaning: string;
  note?: string;
  source: "brain_rendering" | "brain_term";
  score: number;
  confidence: LafzBrainConfidence;
  reasons: string[];
  sourceSongIds: string[];
  sourceNodeIds: string[];
};

export type LafzBrainSymbolHint = {
  symbol: string;
  note?: string;
  frequency: number;
  score: number;
  confidence: LafzBrainConfidence;
  reasons: string[];
  sourceSongIds: string[];
  sourceNodeIds: string[];
};

export type LafzBrainMemoryPackAudit = {
  retrievalVersion: number;
  sourceSongIdsCount: number;
  candidateTextCount: number;
  candidateSignature?: string | null;
  filteredCounts: {
    style: number;
    motif: number;
    relationship: number;
    symbol: number;
    rendering: number;
    semantic: number;
  };
  appliedRules: string[];
};

export type LafzBrainMemoryPack = {
  builtAt: string;
  artistKeys: string[];
  sourceSongIds: string[];
  styleHints: string[];
  styleHintDetails: LafzBrainTextHint[];
  motifHints: string[];
  motifHintDetails: LafzBrainTextHint[];
  relationshipPriors: string[];
  relationshipPriorDetails: LafzBrainTextHint[];
  symbolHints: LafzBrainSymbolHint[];
  renderingHints: LafzBrainRenderingHint[];
  audit: LafzBrainMemoryPackAudit;
};

export type LafzBrainMemoryPackCacheRecord = {
  cacheKey: string;
  payload: LafzBrainMemoryPack;
  updatedAt: string;
  version: number;
};
