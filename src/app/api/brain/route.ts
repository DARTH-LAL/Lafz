import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/features/cloud/supabase";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";
import { buildSongTranslationMemoryPack } from "@/features/brain/memory-pack";
import {
  insertBrainPromotion,
  listBrainClaimsByScope,
  listBrainEvidenceByClaimIds,
  listBrainPromotionsByClaimIds,
  listBrainLearningProfiles,
  readBrainClaimsByIds,
  readMemoryPackCache,
  updateBrainClaim
} from "@/features/brain/repository";
import { buildBrainClaimReviewQueue } from "@/features/brain/review";
import { buildMemoryPackCacheKey, splitArtistCredits } from "@/features/brain/normalize";
import { getAiTranslationDraftByTrackId } from "@/features/ai/repository";
import { NODE_COLORS } from "@/features/brain/colors";
import criticEvalSet from "../../../../data/brain/critic-eval-set.json";
import { buildBrainCriticEvaluationReport } from "@/features/brain/critic-evaluation";
import type { LafzBrainCriticEvalSet } from "@/features/brain/types";
import { ensureCleanupAgentWorkerStarted, getCleanupAgentProcessStatus } from "@/features/brain/cleanup-agent";
import { ensureEntityAgentWorkerStarted, getEntityAgentProcessStatus } from "@/features/brain/entity-agent";
import { ensureMotifAgentWorkerStarted, getMotifAgentProcessStatus } from "@/features/brain/motif-agent";
import { ensurePersonaAgentWorkerStarted, getPersonaAgentProcessStatus } from "@/features/brain/persona-agent";
import { ensureVocabularyAgentWorkerStarted, getVocabularyAgentProcessStatus } from "@/features/brain/vocabulary-agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// How many nodes to fetch per type when showing the full graph
const TYPE_LIMITS: Record<string, number> = {
  artist: 20,
  song: 30,
  motif: 20,
  symbol: 15,
  term_surface: 20,
  term_sense: 15,
  rendering: 10,
  entity_instance: 15,
  entity_type: 10,
  persona_style: 10
};

const AGENT_JOB_TYPES = [
  "vocabulary_agent",
  "entity_agent",
  "motif_agent",
  "persona_agent",
  "cleanup_agent"
] as const;

type AgentJobType = (typeof AGENT_JOB_TYPES)[number];

type AgentJobHealth = {
  activeJobCount: number;
  staleJobCount: number;
  oldestStaleHeartbeatAt: string | null;
  oldestStaleJobAgeMs: number | null;
  sampleStaleJobKeys: string[];
};

type ActiveAgentJobRow = {
  job_type: AgentJobType;
  job_key: string;
  claimed_at: string | null;
  last_heartbeat_at: string | null;
};

function createEmptyAgentJobHealth(): AgentJobHealth {
  return {
    activeJobCount: 0,
    staleJobCount: 0,
    oldestStaleHeartbeatAt: null,
    oldestStaleJobAgeMs: null,
    sampleStaleJobKeys: []
  };
}

function buildAgentJobHealthByType(
  rows: ActiveAgentJobRow[],
  timeoutMsByJobType: Record<AgentJobType, number>
) {
  const rowsByJobType = new Map<AgentJobType, ActiveAgentJobRow[]>();

  for (const row of rows) {
    const existing = rowsByJobType.get(row.job_type) ?? [];
    existing.push(row);
    rowsByJobType.set(row.job_type, existing);
  }

  const nowMs = Date.now();
  const healthByJobType = Object.fromEntries(
    AGENT_JOB_TYPES.map((jobType) => [jobType, createEmptyAgentJobHealth()])
  ) as Record<AgentJobType, AgentJobHealth>;

  for (const jobType of AGENT_JOB_TYPES) {
    const jobRows = rowsByJobType.get(jobType) ?? [];
    const timeoutMs = timeoutMsByJobType[jobType];
    const staleRows = jobRows
      .map((row) => {
        const heartbeatAt = row.last_heartbeat_at ?? row.claimed_at;

        if (!heartbeatAt) {
          return null;
        }

        const heartbeatMs = new Date(heartbeatAt).getTime();

        if (!Number.isFinite(heartbeatMs)) {
          return null;
        }

        return {
          row,
          heartbeatAt,
          heartbeatMs
        };
      })
      .filter((entry): entry is { row: ActiveAgentJobRow; heartbeatAt: string; heartbeatMs: number } => {
        if (!entry) {
          return false;
        }

        return nowMs - entry.heartbeatMs >= timeoutMs;
      })
      .sort((left, right) => left.heartbeatMs - right.heartbeatMs);

    healthByJobType[jobType] = {
      activeJobCount: jobRows.length,
      staleJobCount: staleRows.length,
      oldestStaleHeartbeatAt: staleRows[0]?.heartbeatAt ?? null,
      oldestStaleJobAgeMs: staleRows[0] ? Math.max(0, nowMs - staleRows[0].heartbeatMs) : null,
      sampleStaleJobKeys: staleRows.slice(0, 5).map((entry) => entry.row.job_key)
    };
  }

  return healthByJobType;
}

function readSecretFromRequest(request: NextRequest) {
  const authorization = request.headers.get("authorization")?.trim();

  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return request.headers.get("x-lafz-agent-secret")?.trim() ?? null;
}

function isRunnerAuthorized(request: NextRequest) {
  const expectedSecret = process.env.LAFZ_AGENT_RUNNER_SECRET?.trim();

  if (!expectedSecret) {
    return false;
  }

  return readSecretFromRequest(request) === expectedSecret;
}

export async function GET(request: NextRequest) {
  ensureVocabularyAgentWorkerStarted();
  ensureEntityAgentWorkerStarted();
  ensureMotifAgentWorkerStarted();
  ensurePersonaAgentWorkerStarted();
  ensureCleanupAgentWorkerStarted();

  const mode = request.nextUrl.searchParams.get("mode") ?? "graph";
  const session = readSpotifySessionFromRequest(request);
  const runnerAuthorized = isRunnerAuthorized(request);

  if (!session && !(mode === "worker-status" && runnerAuthorized)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const seed = request.nextUrl.searchParams.get("seed") ?? null;
  const nodeType = request.nextUrl.searchParams.get("type") ?? null;
  const spotifyTrackId = request.nextUrl.searchParams.get("spotifyTrackId") ?? null;
  const artist = request.nextUrl.searchParams.get("artist") ?? null;

  try {
    if (mode === "memory-pack") {
      if (!spotifyTrackId || !artist) {
        return NextResponse.json({ error: "spotifyTrackId and artist are required" }, { status: 400 });
      }

      const artistKeys = splitArtistCredits(artist).map((entry) => entry.key);
      const draft = await getAiTranslationDraftByTrackId(spotifyTrackId).catch(() => null);
      const candidateTexts = draft?.lines.slice(0, 24).map((line) => line.original) ?? [];
      const cacheKey = buildMemoryPackCacheKey(artistKeys, spotifyTrackId, candidateTexts);
      const pack = await buildSongTranslationMemoryPack({
        spotifyTrackId,
        artist,
        candidateTexts
      });
      const cached = await readMemoryPackCache(cacheKey);

      return NextResponse.json({
        spotifyTrackId,
        artist,
        cacheKey,
        cachedAt: cached?.updatedAt ?? null,
        cacheVersion: cached?.version ?? null,
        pack
      });
    }

    if (mode === "claims") {
      if (!spotifyTrackId || !artist) {
        return NextResponse.json({ error: "spotifyTrackId and artist are required" }, { status: 400 });
      }

      const artistKeys = splitArtistCredits(artist).map((entry) => entry.key);
      const [songClaims, artistClaims] = await Promise.all([
        listBrainClaimsByScope("song", [spotifyTrackId], 80),
        listBrainClaimsByScope("artist", artistKeys, 80)
      ]);

      const claims = [...songClaims, ...artistClaims].sort((left, right) => {
        const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
        const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
        return rightTime - leftTime;
      });
      const claimIds = claims.map((claim) => claim.id);
      const [evidenceRows, promotionRows, learningProfiles] = await Promise.all([
        listBrainEvidenceByClaimIds(claimIds),
        listBrainPromotionsByClaimIds(claimIds),
        listBrainLearningProfiles(1000)
      ]);

      const evidenceByClaimId = new Map<string, typeof evidenceRows>();
      for (const evidence of evidenceRows) {
        const existing = evidenceByClaimId.get(evidence.claimId) ?? [];
        existing.push(evidence);
        evidenceByClaimId.set(evidence.claimId, existing);
      }

      const latestPromotionByClaimId = new Map<string, (typeof promotionRows)[number]>();
      for (const promotion of promotionRows) {
        if (!latestPromotionByClaimId.has(promotion.claimId)) {
          latestPromotionByClaimId.set(promotion.claimId, promotion);
        }
      }

      const claimReviewQueue = buildBrainClaimReviewQueue({
        claims,
        promotions: promotionRows,
        learningProfiles
      });

      return NextResponse.json({
        spotifyTrackId,
        artist,
        claimCount: claims.length,
        claims: claims.map((claim) => {
          const cleanup =
            typeof claim.payload.cleanup === "object" && claim.payload.cleanup
              ? (claim.payload.cleanup as Record<string, unknown>)
              : {};
          const manual =
            typeof claim.payload.manual === "object" && claim.payload.manual
              ? (claim.payload.manual as Record<string, unknown>)
              : {};

          return {
            id: claim.id,
            claimKey: claim.claimKey,
            claimType: claim.claimType,
            scopeType: claim.scopeType,
            scopeKey: claim.scopeKey,
            status: claim.status,
            confidenceScore: claim.confidenceScore,
            sourceCount: claim.sourceCount,
            evidenceCount: claim.evidenceCount,
            updatedAt: claim.updatedAt,
            payload: claim.payload,
            flags: {
              manualLocked: manual.locked === true || cleanup.locked === true,
              manualOverrideStatus: typeof manual.overrideStatus === "string" ? manual.overrideStatus : null,
              needsRereview: cleanup.needsRereview === true,
              decayCount: typeof cleanup.decayCount === "number" ? cleanup.decayCount : 0,
              lastCleanupRule: typeof cleanup.lastRule === "string" ? cleanup.lastRule : null
            },
            evidence: (evidenceByClaimId.get(claim.id) ?? []).slice(0, 6).map((row) => ({
              id: row.id,
              sourceType: row.sourceType,
              spotifyTrackId: row.spotifyTrackId,
              artistKey: row.artistKey,
              lineOrder: row.lineOrder,
              weight: row.weight,
              payload: row.payload,
              createdAt: row.createdAt
            })),
            latestPromotion: latestPromotionByClaimId.get(claim.id)
              ? {
                  id: latestPromotionByClaimId.get(claim.id)?.id,
                  decision: latestPromotionByClaimId.get(claim.id)?.decision,
                  reason: latestPromotionByClaimId.get(claim.id)?.reason,
                  decidedBy: latestPromotionByClaimId.get(claim.id)?.decidedBy,
                  createdAt: latestPromotionByClaimId.get(claim.id)?.createdAt
                }
              : null
          };
        }),
        reviewQueue: claimReviewQueue.reviewQueue,
        reviewSummary: claimReviewQueue.reviewSummary
      });
    }

  if (mode === "worker-status") {
      const queueStatuses = ["pending", "claimed", "running", "completed", "failed", "dead_lettered"] as const;
      const vocabularyWorker = getVocabularyAgentProcessStatus();
      const entityWorker = getEntityAgentProcessStatus();
      const motifWorker = getMotifAgentProcessStatus();
      const personaWorker = getPersonaAgentProcessStatus();
      const cleanupWorker = getCleanupAgentProcessStatus();
      const criticEvaluation = buildBrainCriticEvaluationReport(criticEvalSet as LafzBrainCriticEvalSet);

      const [vocabularyCounts, entityCounts, motifCounts, personaCounts, cleanupCounts, { data: recentRuns }, { data: recentJobs }, { data: activeJobs }, learningProfiles] = await Promise.all([
        Promise.all(
          queueStatuses.map(async (status) => {
            const { count } = await supabase
              .from("agent_jobs")
              .select("*", { count: "exact", head: true })
              .eq("job_type", "vocabulary_agent")
              .eq("status", status);

            return [status, count ?? 0] as const;
          })
        ),
        Promise.all(
          queueStatuses.map(async (status) => {
            const { count } = await supabase
              .from("agent_jobs")
              .select("*", { count: "exact", head: true })
              .eq("job_type", "entity_agent")
              .eq("status", status);

            return [status, count ?? 0] as const;
          })
        ),
        Promise.all(
          queueStatuses.map(async (status) => {
            const { count } = await supabase
              .from("agent_jobs")
              .select("*", { count: "exact", head: true })
              .eq("job_type", "motif_agent")
              .eq("status", status);

            return [status, count ?? 0] as const;
          })
        ),
        Promise.all(
          queueStatuses.map(async (status) => {
            const { count } = await supabase
              .from("agent_jobs")
              .select("*", { count: "exact", head: true })
              .eq("job_type", "persona_agent")
              .eq("status", status);

            return [status, count ?? 0] as const;
          })
        ),
        Promise.all(
          queueStatuses.map(async (status) => {
            const { count } = await supabase
              .from("agent_jobs")
              .select("*", { count: "exact", head: true })
              .eq("job_type", "cleanup_agent")
              .eq("status", status);

            return [status, count ?? 0] as const;
          })
        ),
        supabase
          .from("agent_runs")
          .select("id, job_id, agent_role, status, worker_id, started_at, finished_at, output_json, error_text, created_at")
          .in("agent_role", ["vocabulary_agent", "entity_agent", "motif_agent", "persona_agent", "cleanup_agent"])
          .order("created_at", { ascending: false })
          .limit(24),
        supabase
          .from("agent_jobs")
          .select("id, job_key, job_type, status, spotify_track_id, claimed_by, claimed_at, updated_at, last_error")
          .in("job_type", ["vocabulary_agent", "entity_agent", "motif_agent", "persona_agent", "cleanup_agent"])
          .order("updated_at", { ascending: false })
          .limit(24),
        supabase
          .from("agent_jobs")
          .select("job_type, job_key, claimed_at, last_heartbeat_at")
          .in("job_type", AGENT_JOB_TYPES)
          .in("status", ["claimed", "running"]),
        listBrainLearningProfiles(24)
      ]);

      const jobHealthByType = buildAgentJobHealthByType((activeJobs ?? []) as ActiveAgentJobRow[], {
        vocabulary_agent: vocabularyWorker.staleJobTimeoutMs,
        entity_agent: entityWorker.staleJobTimeoutMs,
        motif_agent: motifWorker.staleJobTimeoutMs,
        persona_agent: personaWorker.staleJobTimeoutMs,
        cleanup_agent: cleanupWorker.staleJobTimeoutMs
      });

      const recentContributionTotals = (recentRuns ?? []).reduce(
        (totals, run: Record<string, unknown>) => {
          const output = typeof run.output_json === "object" && run.output_json ? run.output_json as Record<string, unknown> : {};
          const agentRole = typeof run.agent_role === "string" ? run.agent_role : "unknown";

          if (agentRole === "vocabulary_agent") {
            totals.vocabulary.claimsUpserted += typeof output.claimsUpserted === "number" ? output.claimsUpserted : 0;
            totals.vocabulary.evidencesInserted += typeof output.evidencesInserted === "number" ? output.evidencesInserted : 0;
            totals.vocabulary.promotionsRecorded += typeof output.promotionsRecorded === "number" ? output.promotionsRecorded : 0;
          }

          if (agentRole === "entity_agent") {
            totals.entity.claimsUpserted += typeof output.claimsUpserted === "number" ? output.claimsUpserted : 0;
            totals.entity.evidencesInserted += typeof output.evidencesInserted === "number" ? output.evidencesInserted : 0;
            totals.entity.promotionsRecorded += typeof output.promotionsRecorded === "number" ? output.promotionsRecorded : 0;
          }

          if (agentRole === "motif_agent") {
            totals.motif.claimsUpserted += typeof output.claimsUpserted === "number" ? output.claimsUpserted : 0;
            totals.motif.evidencesInserted += typeof output.evidencesInserted === "number" ? output.evidencesInserted : 0;
            totals.motif.promotionsRecorded += typeof output.promotionsRecorded === "number" ? output.promotionsRecorded : 0;
          }

          if (agentRole === "persona_agent") {
            totals.persona.claimsUpserted += typeof output.claimsUpserted === "number" ? output.claimsUpserted : 0;
            totals.persona.evidencesInserted += typeof output.evidencesInserted === "number" ? output.evidencesInserted : 0;
            totals.persona.promotionsRecorded += typeof output.promotionsRecorded === "number" ? output.promotionsRecorded : 0;
          }

          if (agentRole === "cleanup_agent") {
            totals.cleanup.actionsApplied += typeof output.actionsApplied === "number" ? output.actionsApplied : 0;
            totals.cleanup.rejected += typeof output.rejected === "number" ? output.rejected : 0;
            totals.cleanup.deprecated += typeof output.deprecated === "number" ? output.deprecated : 0;
          }

          return totals;
        },
        {
          vocabulary: {
            claimsUpserted: 0,
            evidencesInserted: 0,
            promotionsRecorded: 0
          },
          entity: {
            claimsUpserted: 0,
            evidencesInserted: 0,
            promotionsRecorded: 0
          },
          motif: {
            claimsUpserted: 0,
            evidencesInserted: 0,
            promotionsRecorded: 0
          },
          persona: {
            claimsUpserted: 0,
            evidencesInserted: 0,
            promotionsRecorded: 0
          },
          cleanup: {
            actionsApplied: 0,
            rejected: 0,
            deprecated: 0
          }
        }
      );

      const learningSummary = (learningProfiles ?? []).reduce(
        (totals, profile) => {
          totals.profileCount += 1;
          totals.signalCount += profile.signalCount;
          totals.acceptedCount += profile.acceptedCount;
          totals.rejectedCount += profile.rejectedCount;
          totals.deferredCount += profile.deferredCount;
          totals.manualOverrideCount += profile.manualOverrideCount;
          totals.confidenceBiasTotal += profile.confidenceBias;

          if (profile.confidenceBias > 0) {
            totals.positiveProfiles += 1;
          }

          if (profile.confidenceBias < 0) {
            totals.negativeProfiles += 1;
          }

          return totals;
        },
        {
          profileCount: 0,
          signalCount: 0,
          acceptedCount: 0,
          rejectedCount: 0,
          deferredCount: 0,
          manualOverrideCount: 0,
          positiveProfiles: 0,
          negativeProfiles: 0,
          confidenceBiasTotal: 0
        }
      );

      return NextResponse.json({
        worker: {
          ...vocabularyWorker,
          jobHealth: jobHealthByType.vocabulary_agent
        },
        queueCounts: Object.fromEntries(vocabularyCounts),
        entityWorker: {
          ...entityWorker,
          jobHealth: jobHealthByType.entity_agent
        },
        entityQueueCounts: Object.fromEntries(entityCounts),
        motifWorker: {
          ...motifWorker,
          jobHealth: jobHealthByType.motif_agent
        },
        motifQueueCounts: Object.fromEntries(motifCounts),
        personaWorker: {
          ...personaWorker,
          jobHealth: jobHealthByType.persona_agent
        },
        personaQueueCounts: Object.fromEntries(personaCounts),
        cleanupWorker: {
          ...cleanupWorker,
          jobHealth: jobHealthByType.cleanup_agent
        },
        cleanupQueueCounts: Object.fromEntries(cleanupCounts),
        jobHealthByType,
        criticEvaluation,
        learningSummary: {
          ...learningSummary,
          averageConfidenceBias:
            learningSummary.profileCount > 0 ? learningSummary.confidenceBiasTotal / learningSummary.profileCount : 0
        },
        learningProfiles: (learningProfiles ?? []).slice(0, 12),
        recentContributionTotals,
        recentRuns: recentRuns ?? [],
        recentJobs: recentJobs ?? []
      });
    }

    let seedNodes: { id: string; node_type: string; canonical_key: string; display_label: string; metadata: Record<string, unknown>; source_confidence: string }[] = [];

    if (seed) {
      // Search mode — find matching nodes
      const { data } = await supabase
        .from("kg_nodes")
        .select("id, node_type, canonical_key, display_label, metadata, source_confidence")
        .eq("is_active", true)
        .or(`canonical_key.ilike.%${seed}%,display_label.ilike.%${seed}%`)
        .limit(60);
      seedNodes = data ?? [];
    } else if (nodeType) {
      // Single type filter
      const { data } = await supabase
        .from("kg_nodes")
        .select("id, node_type, canonical_key, display_label, metadata, source_confidence")
        .eq("is_active", true)
        .eq("node_type", nodeType)
        .limit(80);
      seedNodes = data ?? [];
    } else {
      // Default: fetch a spread across all node types
      const batches = await Promise.all(
        Object.entries(TYPE_LIMITS).map(([type, limit]) =>
          supabase
            .from("kg_nodes")
            .select("id, node_type, canonical_key, display_label, metadata, source_confidence")
            .eq("is_active", true)
            .eq("node_type", type)
            .limit(limit)
            .then(({ data }) => data ?? [])
        )
      );
      seedNodes = batches.flat();
    }

    if (seedNodes.length === 0) {
      return NextResponse.json({ nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0, nodeTypeCounts: {} } });
    }

    const seedNodeIds = seedNodes.map((n) => n.id);

    // Fetch edges where source is in our seed set
    const { data: outEdges } = await supabase
      .from("kg_edges")
      .select("id, edge_type, source_node_id, target_node_id, weight, metadata, evidence")
      .eq("is_active", true)
      .in("source_node_id", seedNodeIds)
      .limit(600);

    // Fetch edges where target is in our seed set
    const { data: inEdges } = await supabase
      .from("kg_edges")
      .select("id, edge_type, source_node_id, target_node_id, weight, metadata, evidence")
      .eq("is_active", true)
      .in("target_node_id", seedNodeIds)
      .limit(600);

    const allEdges = [
      ...(outEdges ?? []),
      ...(inEdges ?? [])
    ].filter((edge, index, self) =>
      index === self.findIndex((e) => e.id === edge.id)
    );

    // Collect any node IDs referenced in edges that aren't already in our set
    const seedIdSet = new Set(seedNodeIds);
    const extraIds = Array.from(
      new Set(
        allEdges.flatMap((e) => [e.source_node_id, e.target_node_id])
          .filter((id) => !seedIdSet.has(id))
      )
    );

    // Fetch the extra nodes so edges render correctly
    let extraNodes: typeof seedNodes = [];
    if (extraIds.length > 0) {
      const { data } = await supabase
        .from("kg_nodes")
        .select("id, node_type, canonical_key, display_label, metadata, source_confidence")
        .in("id", extraIds.slice(0, 200));
      extraNodes = data ?? [];
    }

    const allNodes = [...seedNodes, ...extraNodes];

    // Stats
    const { count: totalNodes } = await supabase
      .from("kg_nodes")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true);

    const { count: totalEdges } = await supabase
      .from("kg_edges")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true);

    const nodeTypeCounts: Record<string, number> = {};
    for (const node of allNodes) {
      nodeTypeCounts[node.node_type] = (nodeTypeCounts[node.node_type] ?? 0) + 1;
    }

    return NextResponse.json({
      nodes: allNodes.map((node) => ({
        id: node.id,
        label: node.display_label,
        type: node.node_type,
        color: NODE_COLORS[node.node_type] ?? "#ffffff",
        confidence: node.source_confidence,
        metadata: node.metadata
      })),
      edges: allEdges.map((edge) => ({
        source: edge.source_node_id,
        target: edge.target_node_id,
        type: edge.edge_type,
        weight: edge.weight ?? 0.5,
        evidence: edge.evidence,
        metadata: edge.metadata
      })),
      stats: {
        nodeCount: totalNodes ?? 0,
        edgeCount: totalEdges ?? 0,
        nodeTypeCounts
      }
    });
  } catch (error) {
    console.error("Brain graph API error:", error);
    return NextResponse.json({ error: "Failed to load brain graph" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const mode = typeof body?.mode === "string" ? body.mode : null;

    if (mode !== "claim-action") {
      return NextResponse.json({ error: "Unsupported mode" }, { status: 400 });
    }

    const claimId = typeof body?.claimId === "string" ? body.claimId.trim() : "";
    const action = typeof body?.action === "string" ? body.action.trim() : "";
    const note = typeof body?.note === "string" ? body.note.trim() : null;
    const shouldLock = body?.lock === false ? false : true;

    if (!claimId || !action) {
      return NextResponse.json({ error: "claimId and action are required" }, { status: 400 });
    }

    const claim = (await readBrainClaimsByIds([claimId]))[0] ?? null;

    if (!claim) {
      return NextResponse.json({ error: "Claim not found" }, { status: 404 });
    }

    const manualPayload = {
      manual: {
        locked: shouldLock,
        lastAction: action,
        lastActionAt: new Date().toISOString(),
        note
      },
      cleanup: {
        locked: shouldLock
      }
    };

    if (action === "lock") {
      const updated = await updateBrainClaim({
        claimId,
        payloadMerge: {
          manual: {
            locked: true,
            lockedAt: new Date().toISOString(),
            note
          },
          cleanup: {
            locked: true
          }
        }
      });

      return NextResponse.json({ ok: true, claim: updated });
    }

    if (action === "unlock") {
      const updated = await updateBrainClaim({
        claimId,
        payloadMerge: {
          manual: {
            locked: false,
            unlockedAt: new Date().toISOString(),
            note
          },
          cleanup: {
            locked: false
          }
        }
      });

      return NextResponse.json({ ok: true, claim: updated });
    }

    if (action === "restore") {
      await insertBrainPromotion({
        claimId,
        decision: "deferred",
        decidedBy: "manual_restore",
        reason: note ?? "Restored for re-review by a human override.",
        payload: {
          manualAction: "restore"
        }
      });

      const updated = await updateBrainClaim({
        claimId,
        status: "proposed",
        payloadMerge: {
          manual: {
            locked: false,
            restoredAt: new Date().toISOString(),
            note,
            overrideStatus: "proposed"
          },
          cleanup: {
            locked: false,
            needsRereview: false
          }
        }
      });

      return NextResponse.json({ ok: true, claim: updated });
    }

    if (action === "accept" || action === "reject") {
      await insertBrainPromotion({
        claimId,
        decision: action === "accept" ? "accepted" : "rejected",
        decidedBy: "manual_override",
        reason: note ?? `Manually marked as ${action}.`,
        payload: {
          manualAction: action
        }
      });

      const updated = await updateBrainClaim({
        claimId,
        status: action === "accept" ? "accepted" : "rejected",
        payloadMerge: {
          ...manualPayload,
          manual: {
            ...(manualPayload.manual as Record<string, unknown>),
            overrideStatus: action === "accept" ? "accepted" : "rejected"
          }
        }
      });

      return NextResponse.json({ ok: true, claim: updated });
    }

    if (action === "deprecate") {
      await insertBrainPromotion({
        claimId,
        decision: "rejected",
        decidedBy: "manual_override",
        reason: note ?? "Manually deprecated.",
        payload: {
          manualAction: "deprecate",
          nextStatus: "deprecated"
        }
      });

      const updated = await updateBrainClaim({
        claimId,
        status: "deprecated",
        payloadMerge: {
          ...manualPayload,
          manual: {
            ...(manualPayload.manual as Record<string, unknown>),
            overrideStatus: "deprecated"
          }
        }
      });

      return NextResponse.json({ ok: true, claim: updated });
    }

    return NextResponse.json({ error: "Unsupported claim action" }, { status: 400 });
  } catch (error) {
    console.error("Brain claim action API error:", error);
    return NextResponse.json({ error: "Failed to update claim" }, { status: 500 });
  }
}
