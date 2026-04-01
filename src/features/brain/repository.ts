import { getSupabaseServerClient } from "@/features/cloud/supabase";
import type {
  LafzAgentJobRecord,
  LafzAgentJobStatus,
  LafzAgentJobType,
  LafzAgentRunRecord,
  LafzAgentRunStatus,
  LafzAgentScopeType,
  LafzBrainClaimRecord,
  LafzBrainClaimScopeType,
  LafzBrainClaimStatus,
  LafzBrainClaimType,
  LafzBrainEdgeRecord,
  LafzBrainEdgeType,
  LafzBrainEvidenceRecord,
  LafzBrainEvidenceSourceType,
  LafzBrainMemoryPack,
  LafzBrainMemoryPackCacheRecord,
  LafzBrainNodeRecord,
  LafzBrainNodeType,
  LafzBrainPromotionDecision,
  LafzBrainPromotionRecord
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

type UpsertBrainClaimInput = {
  claimKey: string;
  claimType: LafzBrainClaimType;
  scopeType: LafzBrainClaimScopeType;
  scopeKey: string;
  normalizedKey: string;
  confidenceScore?: number;
  payload?: Record<string, unknown>;
  status?: LafzBrainClaimStatus;
  agentSessionId?: string | null;
};

type InsertBrainEvidenceInput = {
  claimId: string;
  sourceType: LafzBrainEvidenceSourceType;
  spotifyTrackId?: string | null;
  artistKey?: string | null;
  lineOrder?: number | null;
  weight?: number;
  payload?: Record<string, unknown>;
  agentSessionId?: string | null;
};

type InsertBrainPromotionInput = {
  claimId: string;
  decision: LafzBrainPromotionDecision;
  promotedNodeId?: string | null;
  promotedEdgeId?: string | null;
  reason?: string | null;
  decidedBy?: string | null;
  payload?: Record<string, unknown>;
};

type EnqueueAgentJobInput = {
  jobKey: string;
  jobType: LafzAgentJobType;
  scopeType: LafzAgentScopeType;
  scopeKey: string;
  spotifyTrackId?: string | null;
  priority?: number;
  availableAt?: string | null;
  payload?: Record<string, unknown>;
  status?: LafzAgentJobStatus;
};

type InsertAgentRunInput = {
  jobId: string;
  agentRole: string;
  workerId?: string | null;
  status?: LafzAgentRunStatus;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  errorText?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
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

function parseBrainClaimRow(row: unknown): LafzBrainClaimRecord | null {
  if (!isRecord(row)) {
    return null;
  }

  const id = asString(row.id);
  const claimKey = asString(row.claim_key);
  const claimType = asString(row.claim_type) as LafzBrainClaimType | null;
  const scopeType = asString(row.scope_type) as LafzBrainClaimScopeType | null;
  const scopeKey = asString(row.scope_key);
  const normalizedKey = asString(row.normalized_key);

  if (!id || !claimKey || !claimType || !scopeType || !scopeKey || !normalizedKey) {
    return null;
  }

  return {
    id,
    claimKey,
    claimType,
    scopeType,
    scopeKey,
    normalizedKey,
    status: (asString(row.status) as LafzBrainClaimStatus | null) ?? "proposed",
    confidenceScore: asNumber(row.confidence_score, 0.5),
    sourceCount: asNumber(row.source_count, 1),
    evidenceCount: asNumber(row.evidence_count, 0),
    payload: isRecord(row.payload_json) ? row.payload_json : {},
    agentSessionId: asString(row.agent_session_id),
    firstSeenAt: asString(row.first_seen_at),
    lastSeenAt: asString(row.last_seen_at),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at)
  };
}

function parseBrainEvidenceRow(row: unknown): LafzBrainEvidenceRecord | null {
  if (!isRecord(row)) {
    return null;
  }

  const id = asString(row.id);
  const claimId = asString(row.claim_id);
  const sourceType = asString(row.source_type) as LafzBrainEvidenceSourceType | null;

  if (!id || !claimId || !sourceType) {
    return null;
  }

  return {
    id,
    claimId,
    sourceType,
    spotifyTrackId: asString(row.spotify_track_id),
    artistKey: asString(row.artist_key),
    lineOrder: typeof row.line_order === "number" && Number.isFinite(row.line_order) ? row.line_order : null,
    weight: asNumber(row.weight, 0.5),
    payload: isRecord(row.payload_json) ? row.payload_json : {},
    agentSessionId: asString(row.agent_session_id),
    createdAt: asString(row.created_at)
  };
}

function parseBrainPromotionRow(row: unknown): LafzBrainPromotionRecord | null {
  if (!isRecord(row)) {
    return null;
  }

  const id = asString(row.id);
  const claimId = asString(row.claim_id);
  const decision = asString(row.decision) as LafzBrainPromotionDecision | null;

  if (!id || !claimId || !decision) {
    return null;
  }

  return {
    id,
    claimId,
    decision,
    promotedNodeId: asString(row.promoted_node_id),
    promotedEdgeId: asString(row.promoted_edge_id),
    reason: asString(row.reason),
    decidedBy: asString(row.decided_by),
    payload: isRecord(row.payload_json) ? row.payload_json : {},
    createdAt: asString(row.created_at)
  };
}

function parseAgentJobRow(row: unknown): LafzAgentJobRecord | null {
  if (!isRecord(row)) {
    return null;
  }

  const id = asString(row.id);
  const jobKey = asString(row.job_key);
  const jobType = asString(row.job_type) as LafzAgentJobType | null;
  const status = asString(row.status) as LafzAgentJobStatus | null;
  const scopeType = asString(row.scope_type) as LafzAgentScopeType | null;
  const scopeKey = asString(row.scope_key);

  if (!id || !jobKey || !jobType || !status || !scopeType || !scopeKey) {
    return null;
  }

  return {
    id,
    jobKey,
    jobType,
    status,
    scopeType,
    scopeKey,
    spotifyTrackId: asString(row.spotify_track_id),
    priority: asNumber(row.priority, 100),
    availableAt: asString(row.available_at),
    claimedAt: asString(row.claimed_at),
    claimedBy: asString(row.claimed_by),
    lastHeartbeatAt: asString(row.last_heartbeat_at),
    attemptCount: asNumber(row.attempt_count, 0),
    lastError: asString(row.last_error),
    payload: isRecord(row.payload_json) ? row.payload_json : {},
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at)
  };
}

function parseAgentRunRow(row: unknown): LafzAgentRunRecord | null {
  if (!isRecord(row)) {
    return null;
  }

  const id = asString(row.id);
  const jobId = asString(row.job_id);
  const agentRole = asString(row.agent_role);
  const status = asString(row.status) as LafzAgentRunStatus | null;

  if (!id || !jobId || !agentRole || !status) {
    return null;
  }

  return {
    id,
    jobId,
    agentRole,
    status,
    workerId: asString(row.worker_id),
    startedAt: asString(row.started_at),
    finishedAt: asString(row.finished_at),
    input: isRecord(row.input_json) ? row.input_json : {},
    output: isRecord(row.output_json) ? row.output_json : {},
    errorText: asString(row.error_text),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at)
  };
}

export function isBrainConfigured() {
  return Boolean(getSupabaseServerClient());
}

export async function readAgentJobByKey(jobKey: string) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.from("agent_jobs").select("*").eq("job_key", jobKey).maybeSingle();

  if (error) {
    logBrainError(`read agent job ${jobKey}`, error);
    return null;
  }

  return parseAgentJobRow(data);
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

export async function enqueueAgentJob(input: EnqueueAgentJobInput) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("agent_jobs")
    .upsert(
      {
        job_key: input.jobKey,
        job_type: input.jobType,
        status: input.status ?? "pending",
        scope_type: input.scopeType,
        scope_key: input.scopeKey,
        spotify_track_id: input.spotifyTrackId ?? null,
        priority: input.priority ?? 100,
        available_at: input.availableAt ?? now,
        payload_json: input.payload ?? {},
        updated_at: now
      },
      {
        onConflict: "job_key"
      }
    )
    .select("*")
    .single();

  if (error) {
    logBrainError(`enqueue agent job ${input.jobKey}`, error);
    return null;
  }

  return parseAgentJobRow(data);
}

export async function claimNextAgentJob(workerId: string, jobType?: LafzAgentJobType | null) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.rpc("claim_next_agent_job", {
    p_worker_id: workerId,
    p_job_type: jobType ?? null
  });

  if (error) {
    logBrainError(`claim next agent job ${jobType ?? "any"}`, error);
    return null;
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return parseAgentJobRow(rows[0] ?? null);
}

export async function updateAgentJobStatus(
  jobId: string,
  status: LafzAgentJobStatus,
  options?: {
    workerId?: string | null;
    heartbeat?: boolean;
    lastError?: string | null;
    availableAt?: string | null;
  }
) {
  const supabase = getSupabaseServerClient();

  if (!supabase || !jobId) {
    return null;
  }

  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString()
  };

  if (options?.workerId !== undefined) {
    patch.claimed_by = options.workerId;
  }

  if (options?.heartbeat) {
    patch.last_heartbeat_at = new Date().toISOString();
  }

  if (options?.lastError !== undefined) {
    patch.last_error = options.lastError ?? null;
  }

  if (options?.availableAt !== undefined) {
    patch.available_at = options.availableAt ?? new Date().toISOString();
  }

  if (status === "running" && !("claimed_at" in patch)) {
    patch.claimed_at = new Date().toISOString();
  }

  if (status === "completed" || status === "failed" || status === "cancelled" || status === "dead_lettered") {
    patch.last_heartbeat_at = new Date().toISOString();
  }

  const { data, error } = await supabase.from("agent_jobs").update(patch).eq("id", jobId).select("*").single();

  if (error) {
    logBrainError(`update agent job ${jobId} -> ${status}`, error);
    return null;
  }

  return parseAgentJobRow(data);
}

export async function heartbeatAgentJob(jobId: string, workerId: string) {
  return updateAgentJobStatus(jobId, "running", {
    workerId,
    heartbeat: true
  });
}

export async function insertAgentRun(input: InsertAgentRunInput) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("agent_runs")
    .insert({
      job_id: input.jobId,
      agent_role: input.agentRole,
      status: input.status ?? "running",
      worker_id: input.workerId ?? null,
      started_at: input.startedAt ?? new Date().toISOString(),
      finished_at: input.finishedAt ?? null,
      input_json: input.input ?? {},
      output_json: input.output ?? {},
      error_text: input.errorText ?? null,
      updated_at: new Date().toISOString()
    })
    .select("*")
    .single();

  if (error) {
    logBrainError(`insert agent run for job ${input.jobId}`, error);
    return null;
  }

  return parseAgentRunRow(data);
}

export async function updateAgentRun(
  runId: string,
  patch: {
    status?: LafzAgentRunStatus;
    output?: Record<string, unknown>;
    errorText?: string | null;
    finishedAt?: string | null;
  }
) {
  const supabase = getSupabaseServerClient();

  if (!supabase || !runId) {
    return null;
  }

  const { data, error } = await supabase
    .from("agent_runs")
    .update({
      status: patch.status,
      output_json: patch.output,
      error_text: patch.errorText,
      finished_at: patch.finishedAt ?? (patch.status && patch.status !== "running" ? new Date().toISOString() : null),
      updated_at: new Date().toISOString()
    })
    .eq("id", runId)
    .select("*")
    .single();

  if (error) {
    logBrainError(`update agent run ${runId}`, error);
    return null;
  }

  return parseAgentRunRow(data);
}

export async function readBrainClaimByKey(claimKey: string) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.from("kg_claims").select("*").eq("claim_key", claimKey).maybeSingle();

  if (error) {
    logBrainError(`read claim ${claimKey}`, error);
    return null;
  }

  return parseBrainClaimRow(data);
}

export async function readBrainClaimsByIds(claimIds: string[]) {
  const supabase = getSupabaseServerClient();

  if (!supabase || claimIds.length === 0) {
    return [] as LafzBrainClaimRecord[];
  }

  const { data, error } = await supabase.from("kg_claims").select("*").in("id", claimIds);

  if (error) {
    logBrainError("read claims by ids", error);
    return [];
  }

  return (data ?? []).map(parseBrainClaimRow).filter((row): row is LafzBrainClaimRecord => Boolean(row));
}

export async function listBrainClaimsByScope(scopeType: LafzBrainClaimScopeType, scopeKeys: string[], limit = 100) {
  const supabase = getSupabaseServerClient();

  if (!supabase || scopeKeys.length === 0) {
    return [] as LafzBrainClaimRecord[];
  }

  const { data, error } = await supabase
    .from("kg_claims")
    .select("*")
    .eq("scope_type", scopeType)
    .in("scope_key", scopeKeys)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    logBrainError(`list claims ${scopeType}`, error);
    return [];
  }

  return (data ?? []).map(parseBrainClaimRow).filter((row): row is LafzBrainClaimRecord => Boolean(row));
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

export async function upsertBrainClaim(input: UpsertBrainClaimInput) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const existing = await readBrainClaimByKey(input.claimKey);
  const now = new Date().toISOString();

  if (existing) {
    const nextConfidenceScore = Math.max(existing.confidenceScore, input.confidenceScore ?? existing.confidenceScore);
    const { data, error } = await supabase
      .from("kg_claims")
      .update({
        confidence_score: nextConfidenceScore,
        payload_json: input.payload ?? existing.payload,
        status: input.status ?? existing.status,
        source_count: existing.sourceCount + 1,
        last_seen_at: now,
        updated_at: now,
        agent_session_id: input.agentSessionId ?? existing.agentSessionId
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) {
      logBrainError(`update claim ${input.claimKey}`, error);
      return null;
    }

    return parseBrainClaimRow(data);
  }

  const { data, error } = await supabase
    .from("kg_claims")
    .insert({
      claim_key: input.claimKey,
      claim_type: input.claimType,
      scope_type: input.scopeType,
      scope_key: input.scopeKey,
      normalized_key: input.normalizedKey,
      status: input.status ?? "proposed",
      confidence_score: input.confidenceScore ?? 0.5,
      source_count: 1,
      evidence_count: 0,
      payload_json: input.payload ?? {},
      agent_session_id: input.agentSessionId ?? null,
      first_seen_at: now,
      last_seen_at: now,
      updated_at: now
    })
    .select("*")
    .single();

  if (error) {
    logBrainError(`insert claim ${input.claimKey}`, error);
    return null;
  }

  return parseBrainClaimRow(data);
}

export async function insertBrainEvidence(input: InsertBrainEvidenceInput) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("kg_evidence")
    .insert({
      claim_id: input.claimId,
      source_type: input.sourceType,
      spotify_track_id: input.spotifyTrackId ?? null,
      artist_key: input.artistKey ?? null,
      line_order: input.lineOrder ?? null,
      weight: input.weight ?? 0.5,
      payload_json: input.payload ?? {},
      agent_session_id: input.agentSessionId ?? null
    })
    .select("*")
    .single();

  if (error) {
    logBrainError(`insert evidence for claim ${input.claimId}`, error);
    return null;
  }

  const existingClaim = await supabase.from("kg_claims").select("evidence_count").eq("id", input.claimId).maybeSingle();
  if (!existingClaim.error && existingClaim.data) {
    const currentEvidenceCount = asNumber((existingClaim.data as { evidence_count?: unknown }).evidence_count, 0);
    const { error: claimUpdateError } = await supabase
      .from("kg_claims")
      .update({
        evidence_count: currentEvidenceCount + 1,
        updated_at: new Date().toISOString()
      })
      .eq("id", input.claimId);

    if (claimUpdateError) {
      logBrainError(`increment evidence count for claim ${input.claimId}`, claimUpdateError);
    }
  }

  return parseBrainEvidenceRow(data);
}

export async function listBrainEvidenceByClaimIds(claimIds: string[]) {
  const supabase = getSupabaseServerClient();

  if (!supabase || claimIds.length === 0) {
    return [] as LafzBrainEvidenceRecord[];
  }

  const { data, error } = await supabase
    .from("kg_evidence")
    .select("*")
    .in("claim_id", claimIds)
    .order("created_at", { ascending: false });

  if (error) {
    logBrainError("list evidence by claim ids", error);
    return [];
  }

  return (data ?? []).map(parseBrainEvidenceRow).filter((row): row is LafzBrainEvidenceRecord => Boolean(row));
}

export async function insertBrainPromotion(input: InsertBrainPromotionInput) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("kg_promotions")
    .insert({
      claim_id: input.claimId,
      decision: input.decision,
      promoted_node_id: input.promotedNodeId ?? null,
      promoted_edge_id: input.promotedEdgeId ?? null,
      reason: input.reason ?? null,
      decided_by: input.decidedBy ?? "phase2a",
      payload_json: input.payload ?? {}
    })
    .select("*")
    .single();

  if (error) {
    logBrainError(`insert promotion for claim ${input.claimId}`, error);
    return null;
  }

  const nextStatus: LafzBrainClaimStatus =
    input.decision === "accepted" ? "accepted" : input.decision === "rejected" ? "rejected" : "proposed";

  const { error: claimUpdateError } = await supabase
    .from("kg_claims")
    .update({
      status: nextStatus,
      updated_at: new Date().toISOString()
    })
    .eq("id", input.claimId);

  if (claimUpdateError) {
    logBrainError(`update promoted claim ${input.claimId}`, claimUpdateError);
  }

  return parseBrainPromotionRow(data);
}

export async function listBrainPromotionsByClaimIds(claimIds: string[]) {
  const supabase = getSupabaseServerClient();

  if (!supabase || claimIds.length === 0) {
    return [] as LafzBrainPromotionRecord[];
  }

  const { data, error } = await supabase
    .from("kg_promotions")
    .select("*")
    .in("claim_id", claimIds)
    .order("created_at", { ascending: false });

  if (error) {
    logBrainError("list promotions by claim ids", error);
    return [];
  }

  return (data ?? []).map(parseBrainPromotionRow).filter((row): row is LafzBrainPromotionRecord => Boolean(row));
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
