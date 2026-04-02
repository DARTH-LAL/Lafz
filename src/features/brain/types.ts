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

export type LafzBrainClaimType =
  | "song_motif_observation"
  | "song_symbol_observation"
  | "song_relationship_observation"
  | "song_vocabulary_observation"
  | "artist_term_usage_observation";

export type LafzBrainClaimScopeType = "global" | "artist" | "song";

export type LafzBrainClaimStatus = "proposed" | "accepted" | "rejected" | "deprecated";

export type LafzBrainEvidenceSourceType =
  | "world_model"
  | "song_context"
  | "artist_memory"
  | "draft_line"
  | "correction_memory"
  | "vocabulary_extractor";

export type LafzBrainPromotionDecision = "accepted" | "rejected" | "deferred";

export type LafzAgentJobType = "vocabulary_agent" | "cleanup_agent";

export type LafzAgentJobStatus = "pending" | "claimed" | "running" | "completed" | "failed" | "cancelled" | "dead_lettered";

export type LafzAgentScopeType = "song" | "artist" | "global";

export type LafzAgentRunStatus = "running" | "completed" | "failed" | "cancelled";

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

export type LafzBrainClaimRecord = {
  id: string;
  claimKey: string;
  claimType: LafzBrainClaimType;
  scopeType: LafzBrainClaimScopeType;
  scopeKey: string;
  normalizedKey: string;
  status: LafzBrainClaimStatus;
  confidenceScore: number;
  sourceCount: number;
  evidenceCount: number;
  payload: Record<string, unknown>;
  agentSessionId: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type LafzBrainEvidenceRecord = {
  id: string;
  claimId: string;
  sourceType: LafzBrainEvidenceSourceType;
  spotifyTrackId: string | null;
  artistKey: string | null;
  lineOrder: number | null;
  weight: number;
  payload: Record<string, unknown>;
  agentSessionId: string | null;
  createdAt: string | null;
};

export type LafzBrainPromotionRecord = {
  id: string;
  claimId: string;
  decision: LafzBrainPromotionDecision;
  promotedNodeId: string | null;
  promotedEdgeId: string | null;
  reason: string | null;
  decidedBy: string | null;
  payload: Record<string, unknown>;
  createdAt: string | null;
};

export type LafzAgentJobRecord = {
  id: string;
  jobKey: string;
  jobType: LafzAgentJobType;
  status: LafzAgentJobStatus;
  scopeType: LafzAgentScopeType;
  scopeKey: string;
  spotifyTrackId: string | null;
  priority: number;
  availableAt: string | null;
  claimedAt: string | null;
  claimedBy: string | null;
  lastHeartbeatAt: string | null;
  attemptCount: number;
  lastError: string | null;
  payload: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
};

export type LafzAgentRunRecord = {
  id: string;
  jobId: string;
  agentRole: string;
  status: LafzAgentRunStatus;
  workerId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  errorText: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};
