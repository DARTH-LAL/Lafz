import type { AiTranslationDraftFile } from "@/features/ai/types";
import { requestOpenAiEmbeddings } from "@/features/ai/openai";
import { getAiTranslationDraftByTrackId } from "@/features/ai/repository";
import { cosineSimilarity } from "@/features/brain/embeddings";
import {
  materializeAcceptedEntityClaims,
  materializeAcceptedMotifClaims,
  materializeAcceptedPersonaClaims,
  materializeAcceptedVocabularyClaims
} from "@/features/brain/materializer";
import { buildSongTranslationMemoryPack } from "@/features/brain/memory-pack";
import {
  enqueueCleanupBacklogBatch,
  getCleanupBacklogRefillCooldownMs,
  hasActiveCleanupAgentJobs,
  isCleanupBacklogAutoRefillEnabled
} from "@/features/brain/cleanup-backlog";
import {
  claimNextAgentJob,
  deactivateBrainEdge,
  heartbeatAgentJob,
  insertAgentRun,
  insertBrainPromotion,
  listBrainClaimsByScope,
  listBrainEvidenceByClaimIds,
  listBrainPromotionsByClaimIds,
  readAgentJobByKey,
  readBrainNodeByTypeAndKey,
  updateAgentJobStatus,
  updateAgentRun,
  updateBrainClaim
} from "@/features/brain/repository";
import {
  buildEntityInstanceKey,
  canonicalizePersonaStyle,
  canonicalizeRelationshipDynamic,
  classifyBrainEntity,
  isDirectiveLikePersonaStyleText,
  isGenericSingleTokenPersonaStyle,
  isReusableArtistEntityClass,
  isSentenceLikePersonaStyleText,
  normalizeBrainKey,
  normalizeBrainText,
  splitArtistCredits,
  tokenizeBrainText,
  uniqStrings
} from "@/features/brain/normalize";
import type {
  LafzBrainClaimRecord,
  LafzBrainEvidenceRecord,
  LafzBrainPromotionRecord
} from "@/features/brain/types";
import { getSupabaseServerClient } from "@/features/cloud/supabase";

const DEFAULT_CLEANUP_AGENT_POLL_MS = 15_000;
const DEFAULT_CLEANUP_AGENT_MAX_ATTEMPTS = 3;
const DEFAULT_CLEANUP_AGENT_RETRY_BASE_MS = 30_000;
const DEFAULT_CLEANUP_AGENT_RETRY_MAX_MS = 10 * 60_000;
const DEFAULT_CLEANUP_AGENT_STALE_JOB_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_CLEANUP_AGENT_HEARTBEAT_MS = 30_000;

type CleanupAgentRuntimeMode = "disabled" | "embedded" | "standalone";

type CleanupAgentRunSummary = {
  jobId: string;
  jobKey: string;
  spotifyTrackId: string;
  claimsReviewed: number;
  actionsApplied: number;
  rejected: number;
  deprecated: number;
  graphRepairsApplied: number;
  duplicatesCollapsed: number;
  reinforcementsTrimmed: number;
  inferredClaimsRejected: number;
  artistMergeTrimmed: number;
  motifClaimsTrimmed: number;
  personaClaimsTrimmed: number;
  symbolClaimsTrimmed: number;
  relationshipClaimsTrimmed: number;
  materializedClaims: number;
  materializedNodeTouches: number;
  materializedEdgeTouches: number;
  invalidatedMemoryPacks: number;
  currentSongPackRefreshed: boolean;
};

type CleanupAction = {
  claim: LafzBrainClaimRecord;
  decision: "rejected" | "deferred";
  nextStatus: "rejected" | "deprecated" | "proposed";
  reason: string;
  cleanupRule: string;
  priority: number;
  winnerClaimId?: string | null;
};

type CleanupAdaptiveProfile = {
  genericPhraseAverageWeightFloor: number;
  genericPhraseUniqueLineFloor: number;
  motifAverageWeightFloor: number;
  symbolAverageWeightFloor: number;
  relationshipAverageWeightFloor: number;
  rereviewAverageWeightFloor: number;
  rereviewAgeDays: number;
  contradictionScoreGap: number;
};

type ClaimEvidenceMetrics = {
  uniqueLineOrders: number;
  draftLineCount: number;
  extractorCount: number;
  worldModelCount: number;
  artistMemoryCount: number;
  totalWeight: number;
  averageWeight: number;
  maxWeight: number;
};

type ClaimSemanticSignal = {
  termSimilarity: number;
  meaningSimilarity: number;
  embeddingSimilarity: number;
  combinedSimilarity: number;
};

type CleanupAgentGlobals = typeof globalThis & {
  __lafzCleanupAgentInterval?: NodeJS.Timeout;
  __lafzCleanupAgentInFlight?: Promise<void> | null;
  __lafzCleanupAgentStartedAt?: string;
  __lafzCleanupAgentLastKickReason?: string | null;
  __lafzCleanupAgentLastActivityAt?: string | null;
  __lafzCleanupAgentLastSummary?: CleanupAgentRunSummary | null;
  __lafzCleanupAgentLastBacklogRefillAt?: string | null;
  __lafzCleanupAgentLastBacklogRefillResult?: {
    enqueued: number;
    candidatesFound: number;
    exhausted: boolean;
    sampleJobKeys: string[];
  } | null;
};

type StaleCleanupAgentJobRow = {
  id: string;
  job_key: string;
  attempt_count: number;
  claimed_by: string | null;
  claimed_at: string | null;
  last_heartbeat_at: string | null;
};

function getCleanupAgentGlobals() {
  return globalThis as CleanupAgentGlobals;
}

const GENERIC_MOTIF_WORDS = new Set([
  "beauty",
  "attraction",
  "closeness",
  "possession",
  "mood",
  "intimacy",
  "hand",
  "holding",
  "nighttime"
]);

const GENERIC_SYMBOL_WORDS = new Set([
  "eyes",
  "gaze",
  "night",
  "jewelry",
  "glasses",
  "luxury",
  "beauty"
]);

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getCleanupAgentRuntimeMode(): CleanupAgentRuntimeMode {
  const explicitMode = process.env.LAFZ_AGENT_RUNTIME_MODE?.trim().toLowerCase();

  if (explicitMode === "embedded" || explicitMode === "standalone" || explicitMode === "disabled") {
    return explicitMode;
  }

  if (process.env.LAFZ_AGENT_WORKER_ENABLED?.trim().toLowerCase() === "true") {
    return "embedded";
  }

  return "disabled";
}

function isCleanupAgentEmbeddedMode() {
  return getCleanupAgentRuntimeMode() === "embedded";
}

function getCleanupAgentWorkerId(fallbackPrefix = "lafz-cleanup-worker") {
  return process.env.LAFZ_CLEANUP_AGENT_WORKER_ID?.trim() || `${fallbackPrefix}-${process.pid}`;
}

function getCleanupAgentPollMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_WORKER_POLL_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CLEANUP_AGENT_POLL_MS;
}

function getCleanupAgentMaxAttempts() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_MAX_ATTEMPTS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CLEANUP_AGENT_MAX_ATTEMPTS;
}

function getCleanupAgentRetryBaseMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_RETRY_BASE_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CLEANUP_AGENT_RETRY_BASE_MS;
}

function getCleanupAgentRetryMaxMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_RETRY_MAX_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CLEANUP_AGENT_RETRY_MAX_MS;
}

function getCleanupAgentStaleJobTimeoutMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_STALE_JOB_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CLEANUP_AGENT_STALE_JOB_TIMEOUT_MS;
}

function getCleanupAgentHeartbeatMs() {
  const raw = Number.parseInt(process.env.LAFZ_CLEANUP_AGENT_HEARTBEAT_MS ?? "", 10);

  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }

  return Math.min(DEFAULT_CLEANUP_AGENT_HEARTBEAT_MS, Math.max(15_000, Math.floor(getCleanupAgentStaleJobTimeoutMs() / 3)));
}

function computeCleanupAgentRetryDelayMs(attemptCount: number) {
  const retryIndex = Math.max(0, attemptCount - 1);
  const delay = getCleanupAgentRetryBaseMs() * 2 ** retryIndex;
  return Math.min(delay, getCleanupAgentRetryMaxMs());
}

function isCleanupClaimCandidate(claim: LafzBrainClaimRecord) {
  if (claim.status === "rejected" || claim.status === "deprecated" || isCleanupLocked(claim)) {
    return false;
  }

  return (
    claim.claimType === "song_vocabulary_observation" ||
    claim.claimType === "artist_term_usage_observation" ||
    claim.claimType === "artist_persona_style_observation" ||
    claim.claimType === "artist_entity_role_observation" ||
    claim.claimType === "artist_relationship_pattern_observation" ||
    claim.claimType === "artist_motif_pattern_observation" ||
    claim.claimType === "song_motif_observation" ||
    claim.claimType === "song_symbol_observation" ||
    claim.claimType === "song_relationship_observation"
  );
}

function getClaimTerm(claim: LafzBrainClaimRecord) {
  return asString(claim.payload.term) ?? null;
}

function getClaimMeaning(claim: LafzBrainClaimRecord) {
  return asString(claim.payload.meaning) ?? null;
}

function getClaimNote(claim: LafzBrainClaimRecord) {
  return asString(claim.payload.note) ?? null;
}

function getClaimTermStem(claim: LafzBrainClaimRecord) {
  const [termStem] = claim.normalizedKey.split("::");
  return termStem?.trim() || null;
}

function getClaimScore(claim: LafzBrainClaimRecord, evidenceMetrics?: ClaimEvidenceMetrics | null) {
  const statusBonus = claim.status === "accepted" ? 100 : claim.status === "proposed" ? 20 : 0;
  const freshness = claim.updatedAt ? new Date(claim.updatedAt).getTime() / 1_000_000_000_000 : 0;
  const evidenceBonus =
    (evidenceMetrics?.averageWeight ?? 0) * 10 +
    (evidenceMetrics?.maxWeight ?? 0) * 4 +
    (evidenceMetrics?.uniqueLineOrders ?? 0) * 0.75 +
    (evidenceMetrics?.artistMemoryCount ?? 0) * 2 +
    (evidenceMetrics?.worldModelCount ?? 0) * 1.5;

  return statusBonus + claim.confidenceScore * 10 + claim.evidenceCount * 2 + claim.sourceCount + freshness + evidenceBonus;
}

function isLikelyGenericEnglishPhrase(value: string | null) {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();

  if (!/^[A-Za-z0-9'\- ]+$/.test(trimmed)) {
    return false;
  }

  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);

  if (words.length < 2 || words.length > 6) {
    return false;
  }

  const conversationalMarkers = new Set([
    "i",
    "i'm",
    "im",
    "you",
    "you're",
    "your",
    "me",
    "my",
    "we",
    "our",
    "won't",
    "dont",
    "don't",
    "cant",
    "can't",
    "alright",
    "okay",
    "baby",
    "please",
    "harmless"
  ]);

  return words.some((word) => conversationalMarkers.has(word));
}

function getClaimMotif(claim: LafzBrainClaimRecord) {
  return asString(claim.payload.motif) ?? null;
}

function getClaimSymbol(claim: LafzBrainClaimRecord) {
  return asString(claim.payload.symbol) ?? null;
}

function getClaimPersonaStyle(claim: LafzBrainClaimRecord) {
  return asString(claim.payload.personaStyle) ?? null;
}

function getClaimSourceEntity(claim: LafzBrainClaimRecord) {
  return asString(claim.payload.sourceEntity) ?? asString(claim.payload.sourceRole) ?? null;
}

function getClaimTargetEntity(claim: LafzBrainClaimRecord) {
  return asString(claim.payload.targetEntity) ?? asString(claim.payload.targetRole) ?? null;
}

function getClaimObservedSongCount(claim: LafzBrainClaimRecord) {
  const observedSongIds = Array.isArray(claim.payload.observedSongIds)
    ? claim.payload.observedSongIds
        .map((value) => asString(value))
        .filter((value): value is string => Boolean(value))
    : [];
  const fallbackTrackId = asString(claim.payload.spotifyTrackId);
  return uniqStrings([...observedSongIds, fallbackTrackId]).length || claim.sourceCount;
}

function getClaimSongNodeId(claim: LafzBrainClaimRecord) {
  return asString(claim.payload.songNodeId) ?? null;
}

function getClaimArtistOwnerKey(claim: LafzBrainClaimRecord) {
  if (claim.scopeType === "artist") {
    return claim.scopeKey;
  }

  return asString(claim.payload.artistKey) ?? null;
}

function getClaimDynamic(claim: LafzBrainClaimRecord) {
  return asString(claim.payload.dynamic) ?? null;
}

function getClaimPowerBalance(claim: LafzBrainClaimRecord) {
  return asString(claim.payload.powerBalance) ?? null;
}

function getClaimEntityClass(claim: LafzBrainClaimRecord) {
  const computedClass = classifyBrainEntity(
    asString(claim.payload.entityKey),
    asString(claim.payload.entityRole) ?? asString(claim.payload.entityLabel),
    asString(claim.payload.description)
  );

  return computedClass !== "other" ? computedClass : asString(claim.payload.entityClass) ?? computedClass;
}

function getClaimSourceEntityClass(claim: LafzBrainClaimRecord) {
  const computedClass = classifyBrainEntity(
    asString(claim.payload.sourceEntityKey),
    asString(claim.payload.sourceRole),
    null
  );

  return computedClass !== "other" ? computedClass : asString(claim.payload.sourceEntityClass) ?? computedClass;
}

function getClaimTargetEntityClass(claim: LafzBrainClaimRecord) {
  const computedClass = classifyBrainEntity(
    asString(claim.payload.targetEntityKey),
    asString(claim.payload.targetRole),
    null
  );

  return computedClass !== "other" ? computedClass : asString(claim.payload.targetEntityClass) ?? computedClass;
}

function getClaimAliases(claim: LafzBrainClaimRecord) {
  return Array.isArray(claim.payload.aliases)
    ? claim.payload.aliases.map((value) => asString(value)).filter((value): value is string => Boolean(value))
    : [];
}

function isCleanupLocked(claim: LafzBrainClaimRecord) {
  const cleanup = isRecord(claim.payload.cleanup) ? claim.payload.cleanup : {};
  const manual = isRecord(claim.payload.manual) ? claim.payload.manual : {};
  return cleanup.locked === true || manual.locked === true;
}

function tokenizeNormalized(value: string | null) {
  return tokenizeBrainText(value);
}

function uniqueTokenSet(values: Array<string | null | undefined>) {
  return new Set(values.flatMap((value) => tokenizeNormalized(asString(value))));
}

function jaccardSimilarity(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;

  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }

  const union = left.size + right.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function bigramDiceCoefficient(left: string | null, right: string | null) {
  const leftText = normalizeBrainText(left);
  const rightText = normalizeBrainText(right);

  if (!leftText || !rightText) {
    return 0;
  }

  if (leftText === rightText) {
    return 1;
  }

  const buildBigrams = (value: string) => {
    if (value.length < 2) {
      return [value];
    }

    const grams: string[] = [];

    for (let index = 0; index < value.length - 1; index += 1) {
      grams.push(value.slice(index, index + 2));
    }

    return grams;
  };

  const leftBigrams = buildBigrams(leftText);
  const rightBigrams = buildBigrams(rightText);
  const rightCounts = new Map<string, number>();

  for (const gram of rightBigrams) {
    rightCounts.set(gram, (rightCounts.get(gram) ?? 0) + 1);
  }

  let overlap = 0;

  for (const gram of leftBigrams) {
    const count = rightCounts.get(gram) ?? 0;

    if (count > 0) {
      overlap += 1;
      rightCounts.set(gram, count - 1);
    }
  }

  return (2 * overlap) / (leftBigrams.length + rightBigrams.length);
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function buildAdaptiveCleanupProfile(
  claims: LafzBrainClaimRecord[],
  evidenceMetricsByClaimId: Map<string, ClaimEvidenceMetrics>
): CleanupAdaptiveProfile {
  const collectAverageWeights = (claimType: LafzBrainClaimRecord["claimType"]) =>
    claims
      .filter((claim) => claim.claimType === claimType)
      .map((claim) => evidenceMetricsByClaimId.get(claim.id)?.averageWeight ?? 0)
      .filter((value) => value > 0);

  const collectUniqueLineSupport = (claimType: LafzBrainClaimRecord["claimType"]) =>
    claims
      .filter((claim) => claim.claimType === claimType)
      .map((claim) => evidenceMetricsByClaimId.get(claim.id)?.uniqueLineOrders ?? 0)
      .filter((value) => value > 0);

  const vocabularyWeights = collectAverageWeights("song_vocabulary_observation");
  const motifWeights = collectAverageWeights("song_motif_observation");
  const symbolWeights = collectAverageWeights("song_symbol_observation");
  const relationshipWeights = [
    ...collectAverageWeights("song_relationship_observation"),
    ...collectAverageWeights("artist_relationship_pattern_observation")
  ];
  const vocabularyLineSupport = collectUniqueLineSupport("song_vocabulary_observation");

  return {
    genericPhraseAverageWeightFloor: clamp(median(vocabularyWeights) - 0.08, 0.68, 0.85),
    genericPhraseUniqueLineFloor: clamp(Math.round(median(vocabularyLineSupport) || 1), 1, 3),
    motifAverageWeightFloor: clamp(median(motifWeights) - 0.05, 0.68, 0.86),
    symbolAverageWeightFloor: clamp(median(symbolWeights) - 0.05, 0.68, 0.86),
    relationshipAverageWeightFloor: clamp(median(relationshipWeights) - 0.04, 0.7, 0.88),
    rereviewAverageWeightFloor: clamp(median([...vocabularyWeights, ...motifWeights, ...symbolWeights]) - 0.1, 0.58, 0.78),
    rereviewAgeDays: 21,
    contradictionScoreGap: 6
  };
}

function isLowSignalMotifLabel(value: string | null) {
  const tokens = tokenizeNormalized(value);
  return tokens.length > 0 && tokens.length <= 2 && tokens.every((token) => GENERIC_MOTIF_WORDS.has(token));
}

function isLowSignalSymbolLabel(value: string | null) {
  const tokens = tokenizeNormalized(value);
  return tokens.length > 0 && tokens.length <= 2 && tokens.every((token) => GENERIC_SYMBOL_WORDS.has(token));
}

function buildEvidenceMetricsByClaimId(evidenceRows: LafzBrainEvidenceRecord[]) {
  const byClaimId = new Map<string, ClaimEvidenceMetrics>();
  const lineOrderSets = new Map<string, Set<number>>();

  for (const evidence of evidenceRows) {
    const existing = byClaimId.get(evidence.claimId) ?? {
      uniqueLineOrders: 0,
      draftLineCount: 0,
      extractorCount: 0,
      worldModelCount: 0,
      artistMemoryCount: 0,
      totalWeight: 0,
      averageWeight: 0,
      maxWeight: 0
    };

    existing.totalWeight += evidence.weight;
    existing.maxWeight = Math.max(existing.maxWeight, evidence.weight);

    if (evidence.sourceType === "draft_line") {
      existing.draftLineCount += 1;
    }

    if (evidence.sourceType === "vocabulary_extractor") {
      existing.extractorCount += 1;
    }

    if (evidence.sourceType === "world_model") {
      existing.worldModelCount += 1;
    }

    if (evidence.sourceType === "artist_memory") {
      existing.artistMemoryCount += 1;
    }

    byClaimId.set(evidence.claimId, existing);

    if (typeof evidence.lineOrder !== "number") {
      continue;
    }

    const set = lineOrderSets.get(evidence.claimId) ?? new Set<number>();
    set.add(evidence.lineOrder);
    lineOrderSets.set(evidence.claimId, set);
  }

  for (const [claimId, metrics] of byClaimId.entries()) {
    const evidenceCount =
      metrics.draftLineCount + metrics.extractorCount + metrics.worldModelCount + metrics.artistMemoryCount;
    metrics.averageWeight = evidenceCount > 0 ? metrics.totalWeight / evidenceCount : 0;
    metrics.uniqueLineOrders = lineOrderSets.get(claimId)?.size ?? 0;
  }

  return byClaimId;
}

function buildClaimSemanticText(claim: LafzBrainClaimRecord) {
  if (claim.claimType === "song_relationship_observation" || claim.claimType === "artist_relationship_pattern_observation") {
    return [
      claim.claimType,
      getClaimSourceEntity(claim),
      asString(claim.payload.dynamicFamilyLabel) ?? getClaimDynamic(claim),
      getClaimTargetEntity(claim),
      getClaimPowerBalance(claim)
    ]
      .map((value) => normalizeBrainText(value))
      .filter(Boolean)
      .join(" | ");
  }

  return [
    claim.claimType,
    getClaimTerm(claim),
    ...getClaimAliases(claim),
    getClaimMeaning(claim),
    getClaimPersonaStyle(claim),
    getClaimMotif(claim),
    getClaimSymbol(claim),
    getClaimNote(claim)
  ]
    .map((value) => normalizeBrainText(value))
    .filter(Boolean)
    .join(" | ");
}

async function buildClaimEmbeddingMap(claims: LafzBrainClaimRecord[]) {
  const uniqueTexts = uniqStrings(claims.map((claim) => buildClaimSemanticText(claim)).filter(Boolean));

  if (uniqueTexts.length < 2) {
    return new Map<string, number[]>();
  }

  try {
    const embeddings = await requestOpenAiEmbeddings(uniqueTexts);
    const textToEmbedding = new Map<string, number[]>();

    uniqueTexts.forEach((text, index) => {
      const embedding = embeddings[index];

      if (embedding) {
        textToEmbedding.set(text, embedding);
      }
    });

    const byClaimId = new Map<string, number[]>();

    for (const claim of claims) {
      const text = buildClaimSemanticText(claim);
      const embedding = textToEmbedding.get(text);

      if (embedding) {
        byClaimId.set(claim.id, embedding);
      }
    }

    return byClaimId;
  } catch (error) {
    console.error("[lafz-brain] cleanup agent could not build claim embeddings.", error);
    return new Map<string, number[]>();
  }
}

function getClaimSemanticSignal(
  left: LafzBrainClaimRecord,
  right: LafzBrainClaimRecord,
  embeddingByClaimId: Map<string, number[]>
): ClaimSemanticSignal {
  const leftTermTokens = uniqueTokenSet([getClaimTerm(left), ...getClaimAliases(left)]);
  const rightTermTokens = uniqueTokenSet([getClaimTerm(right), ...getClaimAliases(right)]);
  const leftMeaningTokens = uniqueTokenSet([getClaimMeaning(left), getClaimNote(left)]);
  const rightMeaningTokens = uniqueTokenSet([getClaimMeaning(right), getClaimNote(right)]);
  const termSimilarity = Math.max(
    jaccardSimilarity(leftTermTokens, rightTermTokens),
    bigramDiceCoefficient(getClaimTerm(left), getClaimTerm(right))
  );
  const meaningSimilarity = jaccardSimilarity(leftMeaningTokens, rightMeaningTokens);
  const embeddingSimilarity = cosineSimilarity(
    embeddingByClaimId.get(left.id) ?? [],
    embeddingByClaimId.get(right.id) ?? []
  );
  const combinedSimilarity = Math.max(
    embeddingSimilarity,
    termSimilarity * 0.55 + meaningSimilarity * 0.45
  );

  return {
    termSimilarity,
    meaningSimilarity,
    embeddingSimilarity,
    combinedSimilarity
  };
}

function getLatestPromotionByClaimId(promotions: LafzBrainPromotionRecord[]) {
  const latest = new Map<string, LafzBrainPromotionRecord>();

  for (const promotion of promotions) {
    if (!latest.has(promotion.claimId)) {
      latest.set(promotion.claimId, promotion);
    }
  }

  return latest;
}

function classifyRelationshipDynamic(dynamic: string | null) {
  const family = canonicalizeRelationshipDynamic(dynamic);
  const key = family?.canonicalKey ?? normalizeBrainKey(dynamic);

  if (key === "warning-and-dominance") {
    return "hostile";
  }

  if (key === "loyalty-and-backing" || key === "healing-and-reassurance") {
    return "supportive";
  }

  if (key === "devotion-and-longing" || key === "teasing-and-attraction") {
    return "yearning";
  }

  return "neutral";
}

function registerCleanupAction(actionMap: Map<string, CleanupAction>, action: CleanupAction) {
  const existing = actionMap.get(action.claim.id);

  if (!existing || action.priority > existing.priority) {
    actionMap.set(action.claim.id, action);
  }
}

function buildDuplicateCleanupActions(
  claims: LafzBrainClaimRecord[],
  evidenceMetricsByClaimId: Map<string, ClaimEvidenceMetrics>
) {
  const grouped = new Map<string, LafzBrainClaimRecord[]>();

  for (const claim of claims) {
    if (!isCleanupClaimCandidate(claim)) {
      continue;
    }

    const termStem = getClaimTermStem(claim);

    if (!termStem) {
      continue;
    }

    const key = [claim.scopeType, claim.scopeKey, claim.claimType, termStem].join("::");
    const bucket = grouped.get(key) ?? [];
    bucket.push(claim);
    grouped.set(key, bucket);
  }

  const actionMap = new Map<string, CleanupAction>();

  for (const claimsForTerm of grouped.values()) {
    if (claimsForTerm.length < 2) {
      continue;
    }

    const ranked = [...claimsForTerm].sort(
      (left, right) =>
        getClaimScore(right, evidenceMetricsByClaimId.get(right.id)) -
        getClaimScore(left, evidenceMetricsByClaimId.get(left.id))
    );
    const winner = ranked[0];
    const winnerTerm = getClaimTerm(winner) ?? getClaimTermStem(winner) ?? "this term";

    for (const claim of ranked.slice(1)) {
      registerCleanupAction(actionMap, {
        claim,
        decision: "rejected",
        nextStatus: "deprecated",
        cleanupRule: "duplicate_term_variant",
        priority: 100,
        winnerClaimId: winner.id,
        reason: `Cleanup agent deprecated a weaker duplicate vocabulary claim for "${winnerTerm}" in favor of the stronger version.`
      });
    }
  }

  return actionMap;
}

function buildSemanticVocabularyMergeActions(
  claims: LafzBrainClaimRecord[],
  evidenceMetricsByClaimId: Map<string, ClaimEvidenceMetrics>,
  embeddingByClaimId: Map<string, number[]>
) {
  const vocabularyClaims = claims.filter(
    (claim) =>
      (claim.claimType === "song_vocabulary_observation" || claim.claimType === "artist_term_usage_observation") &&
      isCleanupClaimCandidate(claim)
  );
  const actionMap = new Map<string, CleanupAction>();

  for (let leftIndex = 0; leftIndex < vocabularyClaims.length; leftIndex += 1) {
    const left = vocabularyClaims[leftIndex];

    for (let rightIndex = leftIndex + 1; rightIndex < vocabularyClaims.length; rightIndex += 1) {
      const right = vocabularyClaims[rightIndex];
      const sameArtistFamily = Boolean(
        getClaimArtistOwnerKey(left) &&
          getClaimArtistOwnerKey(right) &&
          getClaimArtistOwnerKey(left) === getClaimArtistOwnerKey(right)
      );

      if (!sameArtistFamily) {
        continue;
      }

      const signal = getClaimSemanticSignal(left, right, embeddingByClaimId);
      const looksLikeSemanticDuplicate =
        signal.combinedSimilarity >= 0.9 ||
        (signal.termSimilarity >= 0.74 && signal.meaningSimilarity >= 0.24) ||
        (signal.embeddingSimilarity >= 0.86 && signal.termSimilarity >= 0.5);

      if (!looksLikeSemanticDuplicate) {
        continue;
      }

      const leftScore = getClaimScore(left, evidenceMetricsByClaimId.get(left.id));
      const rightScore = getClaimScore(right, evidenceMetricsByClaimId.get(right.id));
      const [winner, loser] = leftScore >= rightScore ? [left, right] : [right, left];
      const term = getClaimTerm(loser) ?? getClaimTerm(winner) ?? getClaimTermStem(winner) ?? "this term";

      registerCleanupAction(actionMap, {
        claim: loser,
        decision: "rejected",
        nextStatus: loser.scopeType === "song" ? "deprecated" : "rejected",
        cleanupRule: "semantic_duplicate_merge",
        priority: 96,
        winnerClaimId: winner.id,
        reason: `Cleanup agent merged a weaker semantic duplicate for "${term}" into the stronger existing memory.`
      });
    }
  }

  return actionMap;
}

function buildArtistSupersededActions(
  songClaims: LafzBrainClaimRecord[],
  artistClaims: LafzBrainClaimRecord[],
  evidenceMetricsByClaimId: Map<string, ClaimEvidenceMetrics>
) {
  const actionMap = new Map<string, CleanupAction>();
  const acceptedArtistClaims = artistClaims.filter(
    (claim) => claim.claimType === "artist_term_usage_observation" && claim.status === "accepted"
  );

  for (const claim of songClaims) {
    if (claim.claimType !== "song_vocabulary_observation" || !isCleanupClaimCandidate(claim)) {
      continue;
    }

    const matchingArtistClaim = acceptedArtistClaims.find(
      (artistClaim) =>
        artistClaim.normalizedKey === claim.normalizedKey ||
        getClaimTermStem(artistClaim) === getClaimTermStem(claim)
    );

    if (!matchingArtistClaim) {
      continue;
    }

    const songScore = getClaimScore(claim, evidenceMetricsByClaimId.get(claim.id));
    const artistScore = getClaimScore(matchingArtistClaim, evidenceMetricsByClaimId.get(matchingArtistClaim.id));

    if (artistScore < songScore) {
      continue;
    }

    const term = getClaimTerm(claim) ?? getClaimTermStem(claim) ?? "this term";

    registerCleanupAction(actionMap, {
      claim,
      decision: "rejected",
      nextStatus: "deprecated",
      cleanupRule: "superseded_by_artist_memory",
      priority: 95,
      winnerClaimId: matchingArtistClaim.id,
      reason: `Cleanup agent deprecated song-level vocabulary for "${term}" because stronger artist-level memory already exists.`
    });
  }

  return actionMap;
}

function buildContradictionCleanupActions(
  claims: LafzBrainClaimRecord[],
  evidenceMetricsByClaimId: Map<string, ClaimEvidenceMetrics>,
  embeddingByClaimId: Map<string, number[]>,
  adaptiveProfile: CleanupAdaptiveProfile
) {
  const vocabularyClaims = claims.filter(
    (claim) =>
      (claim.claimType === "song_vocabulary_observation" || claim.claimType === "artist_term_usage_observation") &&
      isCleanupClaimCandidate(claim)
  );
  const actionMap = new Map<string, CleanupAction>();

  for (let leftIndex = 0; leftIndex < vocabularyClaims.length; leftIndex += 1) {
    const left = vocabularyClaims[leftIndex];

    for (let rightIndex = leftIndex + 1; rightIndex < vocabularyClaims.length; rightIndex += 1) {
      const right = vocabularyClaims[rightIndex];
      const sameArtistFamily = Boolean(
        getClaimArtistOwnerKey(left) &&
          getClaimArtistOwnerKey(right) &&
          getClaimArtistOwnerKey(left) === getClaimArtistOwnerKey(right)
      );

      if (!sameArtistFamily) {
        continue;
      }

      const signal = getClaimSemanticSignal(left, right, embeddingByClaimId);
      const sameTermFamily =
        signal.termSimilarity >= 0.82 ||
        getClaimTermStem(left) === getClaimTermStem(right);
      const conflictingMeanings =
        signal.meaningSimilarity <= 0.16 &&
        signal.embeddingSimilarity <= 0.8;

      if (!sameTermFamily || !conflictingMeanings) {
        continue;
      }

      const leftScore = getClaimScore(left, evidenceMetricsByClaimId.get(left.id));
      const rightScore = getClaimScore(right, evidenceMetricsByClaimId.get(right.id));

      if (Math.abs(leftScore - rightScore) < adaptiveProfile.contradictionScoreGap) {
        continue;
      }

      const [winner, loser] = leftScore >= rightScore ? [left, right] : [right, left];
      const term = getClaimTerm(loser) ?? getClaimTerm(winner) ?? getClaimTermStem(winner) ?? "this term";

      registerCleanupAction(actionMap, {
        claim: loser,
        decision: "rejected",
        nextStatus: loser.scopeType === "song" ? "deprecated" : "rejected",
        cleanupRule: "contradictory_term_meaning",
        priority: 98,
        winnerClaimId: winner.id,
        reason: `Cleanup agent rejected a conflicting meaning for "${term}" because stronger evidence supports a different interpretation.`
      });
    }
  }

  return actionMap;
}

function buildRedundantExistingTermActions(claims: LafzBrainClaimRecord[]) {
  const actionMap = new Map<string, CleanupAction>();

  for (const claim of claims) {
    if (claim.claimType !== "song_vocabulary_observation" || !isCleanupClaimCandidate(claim)) {
      continue;
    }

    const note = getClaimNote(claim)?.toLowerCase() ?? "";

    if (!note.includes("already present in existingterms") && !note.includes("already listed in existingterms")) {
      continue;
    }

    const term = getClaimTerm(claim) ?? getClaimTermStem(claim) ?? "this term";

    registerCleanupAction(actionMap, {
      claim,
      decision: "rejected",
      nextStatus: "deprecated",
      cleanupRule: "redundant_existing_term",
      priority: 80,
      reason: `Cleanup agent deprecated redundant reinforcement for "${term}" because it was already known in Lafz memory.`
    });
  }

  return actionMap;
}

function buildImpliedInferenceActions(claims: LafzBrainClaimRecord[]) {
  const actionMap = new Map<string, CleanupAction>();

  for (const claim of claims) {
    if (claim.claimType !== "song_vocabulary_observation" || !isCleanupClaimCandidate(claim)) {
      continue;
    }

    const note = getClaimNote(claim)?.toLowerCase() ?? "";

    if (!note.includes("implied by")) {
      continue;
    }

    const term = getClaimTerm(claim) ?? getClaimTermStem(claim) ?? "this term";

    registerCleanupAction(actionMap, {
      claim,
      decision: "rejected",
      nextStatus: "rejected",
      cleanupRule: "implied_not_explicit",
      priority: 90,
      reason: `Cleanup agent rejected inferred vocabulary for "${term}" because it was implied by the line, not explicitly present.`
    });
  }

  return actionMap;
}

function buildGenericPhraseActions(
  claims: LafzBrainClaimRecord[],
  evidenceMetricsByClaimId: Map<string, ClaimEvidenceMetrics>,
  adaptiveProfile: CleanupAdaptiveProfile
) {
  const actionMap = new Map<string, CleanupAction>();

  for (const claim of claims) {
    if (claim.claimType !== "song_vocabulary_observation" || !isCleanupClaimCandidate(claim)) {
      continue;
    }

    const term = getClaimTerm(claim);

    if (!isLikelyGenericEnglishPhrase(term)) {
      continue;
    }

    const evidence = evidenceMetricsByClaimId.get(claim.id);

    if (
      claim.status === "accepted" ||
      claim.evidenceCount > 2 ||
      (evidence?.averageWeight ?? 0) >= adaptiveProfile.genericPhraseAverageWeightFloor ||
      (evidence?.uniqueLineOrders ?? 0) >= adaptiveProfile.genericPhraseUniqueLineFloor
    ) {
      continue;
    }

    registerCleanupAction(actionMap, {
      claim,
      decision: "rejected",
      nextStatus: "rejected",
      cleanupRule: "generic_english_phrase",
      priority: 70,
      reason: `Cleanup agent rejected a low-signal generic English phrase claim for "${term}".`
    });
  }

  return actionMap;
}

function buildMotifCleanupActions(
  claims: LafzBrainClaimRecord[],
  evidenceMetricsByClaimId: Map<string, ClaimEvidenceMetrics>,
  adaptiveProfile: CleanupAdaptiveProfile
) {
  const actionMap = new Map<string, CleanupAction>();

  for (const claim of claims) {
    if (
      (claim.claimType !== "song_motif_observation" && claim.claimType !== "artist_motif_pattern_observation") ||
      !isCleanupClaimCandidate(claim)
    ) {
      continue;
    }

    const motif = getClaimMotif(claim) ?? claim.normalizedKey;
    const policy = isRecord(claim.payload.policy) ? claim.payload.policy : {};
    const shouldInject = policy.shouldInject !== false;
    const scope = asString(policy.scope);
    const evidence = evidenceMetricsByClaimId.get(claim.id);
    const lowEvidence =
      (evidence?.averageWeight ?? 0) < adaptiveProfile.motifAverageWeightFloor && (evidence?.worldModelCount ?? 0) < 1;

    if (scope === "song_local" || !shouldInject) {
      registerCleanupAction(actionMap, {
        claim,
        decision: "rejected",
        nextStatus: "deprecated",
        cleanupRule: claim.claimType === "artist_motif_pattern_observation" ? "artist_song_local_motif" : "song_local_motif",
        priority: 85,
        reason: `Cleanup agent deprecated motif "${motif}" because it is too song-local for durable brain memory.`
      });
      continue;
    }

    if (
      claim.claimType === "artist_motif_pattern_observation" &&
      getClaimObservedSongCount(claim) < 2 &&
      lowEvidence
    ) {
      registerCleanupAction(actionMap, {
        claim,
        decision: "rejected",
        nextStatus: claim.status === "accepted" ? "deprecated" : "rejected",
        cleanupRule: "artist_motif_needs_repetition",
        priority: 82,
        reason: `Cleanup agent held back artist motif "${motif}" because it does not yet repeat across enough songs.`
      });
      continue;
    }

    if (claim.status !== "accepted" && lowEvidence && isLowSignalMotifLabel(motif)) {
      registerCleanupAction(actionMap, {
        claim,
        decision: "rejected",
        nextStatus: "rejected",
        cleanupRule: claim.claimType === "artist_motif_pattern_observation" ? "artist_low_signal_motif" : "low_signal_motif",
        priority: 75,
        reason: `Cleanup agent rejected low-signal motif "${motif}" because it is too abstract and weakly supported.`
      });
    }
  }

  return actionMap;
}

function buildPersonaCleanupActions(
  claims: LafzBrainClaimRecord[],
  evidenceMetricsByClaimId: Map<string, ClaimEvidenceMetrics>,
  adaptiveProfile: CleanupAdaptiveProfile
) {
  const actionMap = new Map<string, CleanupAction>();

  for (const claim of claims) {
    if (claim.claimType !== "artist_persona_style_observation" || !isCleanupClaimCandidate(claim)) {
      continue;
    }

    const personaStyle = getClaimPersonaStyle(claim) ?? claim.normalizedKey;
    const policy = isRecord(claim.payload.policy) ? claim.payload.policy : {};
    const shouldInject = policy.shouldInject !== false;
    const scope = asString(policy.scope);
    const evidence = evidenceMetricsByClaimId.get(claim.id);
    const lowEvidence =
      (evidence?.averageWeight ?? 0) < adaptiveProfile.rereviewAverageWeightFloor &&
      (evidence?.artistMemoryCount ?? 0) < 1;
    const tokenCount = tokenizeNormalized(personaStyle).length;
    const canonicalPersona = canonicalizePersonaStyle(personaStyle);

    if (scope === "song_local" || !shouldInject) {
      registerCleanupAction(actionMap, {
        claim,
        decision: "rejected",
        nextStatus: claim.status === "accepted" ? "deprecated" : "rejected",
        cleanupRule: "generic_persona_style",
        priority: 86,
        reason: `Cleanup agent rejected generic persona style "${personaStyle}" because it is too broad for reusable artist memory.`
      });
      continue;
    }

    if (isDirectiveLikePersonaStyleText(personaStyle)) {
      registerCleanupAction(actionMap, {
        claim,
        decision: "rejected",
        nextStatus: claim.status === "accepted" ? "deprecated" : "rejected",
        cleanupRule: "directive_like_persona_style",
        priority: 90,
        reason: `Cleanup agent rejected persona style "${personaStyle}" because it reads like a translation directive rather than stable artist voice memory.`
      });
      continue;
    }

    if (isGenericSingleTokenPersonaStyle(personaStyle)) {
      registerCleanupAction(actionMap, {
        claim,
        decision: "rejected",
        nextStatus: claim.status === "accepted" ? "deprecated" : "rejected",
        cleanupRule: "generic_single_token_persona_style",
        priority: 88,
        reason: `Cleanup agent rejected persona style "${personaStyle}" because single-word mood labels are too generic for reusable artist memory.`
      });
      continue;
    }

    if (canonicalPersona && canonicalPersona.displayLabel !== personaStyle) {
      registerCleanupAction(actionMap, {
        claim,
        decision: "rejected",
        nextStatus: claim.status === "accepted" ? "deprecated" : "rejected",
        cleanupRule: "canonicalized_persona_duplicate",
        priority: 87,
        reason: `Cleanup agent deprecated persona style "${personaStyle}" because it should collapse into the canonical family "${canonicalPersona.displayLabel}" instead of remaining as raw sentence-level style memory.`
      });
      continue;
    }

    if (!canonicalPersona && isSentenceLikePersonaStyleText(personaStyle)) {
      registerCleanupAction(actionMap, {
        claim,
        decision: "rejected",
        nextStatus: claim.status === "accepted" ? "deprecated" : "rejected",
        cleanupRule: "uncanonicalized_persona_observation",
        priority: 84,
        reason: `Cleanup agent rejected persona style "${personaStyle}" because it is a long observation that never collapsed into a stable canonical style family.`
      });
      continue;
    }

    if (tokenCount >= 7 && lowEvidence) {
      registerCleanupAction(actionMap, {
        claim,
        decision: "rejected",
        nextStatus: claim.status === "accepted" ? "deprecated" : "rejected",
        cleanupRule: "verbose_persona_style",
        priority: 80,
        reason: `Cleanup agent rejected overly verbose persona style "${personaStyle}" because it reads more like a one-off description than stable artist voice memory.`
      });
      continue;
    }

    if (getClaimObservedSongCount(claim) < 2 && lowEvidence) {
      registerCleanupAction(actionMap, {
        claim,
        decision: "rejected",
        nextStatus: claim.status === "accepted" ? "deprecated" : "rejected",
        cleanupRule: "persona_style_needs_repetition",
        priority: 84,
        reason: `Cleanup agent held back persona style "${personaStyle}" because it has not repeated across enough songs yet.`
      });
    }
  }

  return actionMap;
}

function buildSymbolCleanupActions(
  claims: LafzBrainClaimRecord[],
  evidenceMetricsByClaimId: Map<string, ClaimEvidenceMetrics>,
  adaptiveProfile: CleanupAdaptiveProfile
) {
  const actionMap = new Map<string, CleanupAction>();

  for (const claim of claims) {
    if (claim.claimType !== "song_symbol_observation" || !isCleanupClaimCandidate(claim)) {
      continue;
    }

    const symbol = getClaimSymbol(claim) ?? claim.normalizedKey;
    const policy = isRecord(claim.payload.policy) ? claim.payload.policy : {};
    const shouldInject = policy.shouldInject !== false;
    const scope = asString(policy.scope);
    const evidence = evidenceMetricsByClaimId.get(claim.id);
    const lowEvidence =
      (evidence?.averageWeight ?? 0) < adaptiveProfile.symbolAverageWeightFloor && (evidence?.worldModelCount ?? 0) < 1;

    if (scope === "song_local" || !shouldInject) {
      registerCleanupAction(actionMap, {
        claim,
        decision: "rejected",
        nextStatus: "deprecated",
        cleanupRule: "song_local_symbol",
        priority: 85,
        reason: `Cleanup agent deprecated symbol "${symbol}" because it is too song-local for durable graph memory.`
      });
      continue;
    }

    if (claim.status !== "accepted" && lowEvidence && isLowSignalSymbolLabel(symbol)) {
      registerCleanupAction(actionMap, {
        claim,
        decision: "rejected",
        nextStatus: "rejected",
        cleanupRule: "low_signal_symbol",
        priority: 75,
        reason: `Cleanup agent rejected low-signal symbol "${symbol}" because it is too generic and weakly supported.`
      });
    }
  }

  return actionMap;
}

function buildEntityRoleCleanupActions(
  claims: LafzBrainClaimRecord[],
  evidenceMetricsByClaimId: Map<string, ClaimEvidenceMetrics>
) {
  const actionMap = new Map<string, CleanupAction>();
  const hardNonReusableClasses = new Set(["place", "body_part", "material_object", "symbolic", "abstract", "other"]);

  for (const claim of claims) {
    if (claim.claimType !== "artist_entity_role_observation" || !isCleanupClaimCandidate(claim)) {
      continue;
    }

    const entityClass =
      getClaimEntityClass(claim) ??
      classifyBrainEntity(asString(claim.payload.entityKey), asString(claim.payload.entityRole), asString(claim.payload.description));
    const reusableEntity = isReusableArtistEntityClass(entityClass);
    const evidence = evidenceMetricsByClaimId.get(claim.id);
    const lowSupport = (evidence?.averageWeight ?? 0) < 0.76 && getClaimObservedSongCount(claim) < 3;

    if (!reusableEntity && (lowSupport || hardNonReusableClasses.has(entityClass ?? "other"))) {
      registerCleanupAction(actionMap, {
        claim,
        decision: "rejected",
        nextStatus: claim.status === "accepted" ? "deprecated" : "rejected",
        cleanupRule: "non_reusable_entity_role",
        priority: 90,
        reason: `Cleanup agent moved "${asString(claim.payload.entityRole) ?? "entity"}" out of artist-entity memory because it behaves more like a symbolic or abstract concept than a reusable actor pattern.`
      });
    }
  }

  return actionMap;
}

function buildRelationshipCleanupActions(
  claims: LafzBrainClaimRecord[],
  evidenceMetricsByClaimId: Map<string, ClaimEvidenceMetrics>,
  adaptiveProfile: CleanupAdaptiveProfile
) {
  const actionMap = new Map<string, CleanupAction>();
  const hardNonReusableClasses = new Set(["place", "body_part", "material_object", "symbolic", "abstract", "other"]);

  for (const claim of claims) {
    if (
      (claim.claimType !== "song_relationship_observation" &&
        claim.claimType !== "artist_relationship_pattern_observation") ||
      !isCleanupClaimCandidate(claim)
    ) {
      continue;
    }

    const sourceEntity = getClaimSourceEntity(claim);
    const targetEntity = getClaimTargetEntity(claim);
    const sourceEntityClass =
      getClaimSourceEntityClass(claim) ?? classifyBrainEntity(sourceEntity, sourceEntity, null);
    const targetEntityClass =
      getClaimTargetEntityClass(claim) ?? classifyBrainEntity(targetEntity, targetEntity, null);
    const evidence = evidenceMetricsByClaimId.get(claim.id);
    const lowEvidence =
      (evidence?.averageWeight ?? 0) < adaptiveProfile.relationshipAverageWeightFloor &&
      (evidence?.worldModelCount ?? 0) < 1;
    const nonActorRelationship =
      !isReusableArtistEntityClass(sourceEntityClass) || !isReusableArtistEntityClass(targetEntityClass);

    const hardNonReusableRelationship =
      hardNonReusableClasses.has(sourceEntityClass ?? "other") || hardNonReusableClasses.has(targetEntityClass ?? "other");

    if (nonActorRelationship && (hardNonReusableRelationship || (claim.confidenceScore < 0.85 && lowEvidence))) {
      registerCleanupAction(actionMap, {
        claim,
        decision: "rejected",
        nextStatus: claim.status === "accepted" ? "deprecated" : "rejected",
        cleanupRule: "non_actor_relationship",
        priority: 88,
        reason: `Cleanup agent removed a low-signal relationship claim between "${sourceEntity ?? "unknown"}" and "${targetEntity ?? "unknown"}".`
      });
    }
  }

  return actionMap;
}

function buildRelationshipConflictActions(
  claims: LafzBrainClaimRecord[],
  evidenceMetricsByClaimId: Map<string, ClaimEvidenceMetrics>,
  embeddingByClaimId: Map<string, number[]>,
  adaptiveProfile: CleanupAdaptiveProfile
) {
  const relationshipClaims = claims.filter(
    (claim) =>
      (claim.claimType === "song_relationship_observation" ||
        claim.claimType === "artist_relationship_pattern_observation") &&
      isCleanupClaimCandidate(claim)
  );
  const grouped = new Map<string, LafzBrainClaimRecord[]>();

  for (const claim of relationshipClaims) {
    const sourceValue =
      claim.claimType === "artist_relationship_pattern_observation"
        ? asString(claim.payload.sourceRole)
        : getClaimSourceEntity(claim);
    const targetValue =
      claim.claimType === "artist_relationship_pattern_observation"
        ? asString(claim.payload.targetRole)
        : getClaimTargetEntity(claim);
    const key = [claim.scopeKey, normalizeBrainKey(sourceValue), normalizeBrainKey(targetValue)].join("::");
    const bucket = grouped.get(key) ?? [];
    bucket.push(claim);
    grouped.set(key, bucket);
  }

  const actionMap = new Map<string, CleanupAction>();

  for (const bucket of grouped.values()) {
    if (bucket.length < 2) {
      continue;
    }

    for (let leftIndex = 0; leftIndex < bucket.length; leftIndex += 1) {
      const left = bucket[leftIndex];

      for (let rightIndex = leftIndex + 1; rightIndex < bucket.length; rightIndex += 1) {
        const right = bucket[rightIndex];
        const signal = getClaimSemanticSignal(left, right, embeddingByClaimId);
        const leftCategory = classifyRelationshipDynamic(getClaimDynamic(left));
        const rightCategory = classifyRelationshipDynamic(getClaimDynamic(right));
        const conflictingCategory = leftCategory !== rightCategory && leftCategory !== "neutral" && rightCategory !== "neutral";
        const conflictingPower =
          normalizeBrainKey(getClaimPowerBalance(left)) !== normalizeBrainKey(getClaimPowerBalance(right));

        if (!(conflictingCategory || conflictingPower) || signal.embeddingSimilarity >= 0.84) {
          continue;
        }

        const leftScore = getClaimScore(left, evidenceMetricsByClaimId.get(left.id));
        const rightScore = getClaimScore(right, evidenceMetricsByClaimId.get(right.id));

        if (Math.abs(leftScore - rightScore) < adaptiveProfile.contradictionScoreGap) {
          continue;
        }

        const [winner, loser] = leftScore >= rightScore ? [left, right] : [right, left];

        registerCleanupAction(actionMap, {
          claim: loser,
          decision: "rejected",
          nextStatus: loser.status === "accepted" ? "deprecated" : "rejected",
          cleanupRule: "relationship_conflict",
          priority: 97,
          winnerClaimId: winner.id,
          reason: `Cleanup agent removed a conflicting relationship interpretation because stronger evidence supports a different dynamic.`
        });
      }
    }
  }

  return actionMap;
}

function buildStaleRereviewActions(
  claims: LafzBrainClaimRecord[],
  evidenceMetricsByClaimId: Map<string, ClaimEvidenceMetrics>,
  adaptiveProfile: CleanupAdaptiveProfile
) {
  const actionMap = new Map<string, CleanupAction>();
  const cutoffMs = adaptiveProfile.rereviewAgeDays * 24 * 60 * 60 * 1000;

  for (const claim of claims) {
    if (!isCleanupClaimCandidate(claim) || claim.status !== "accepted") {
      continue;
    }

    const cleanup = isRecord(claim.payload.cleanup) ? claim.payload.cleanup : {};
    const lastReviewedAt = asString(cleanup.lastReviewAt);
    const comparisonTime = claim.lastSeenAt ?? claim.updatedAt ?? claim.createdAt ?? lastReviewedAt;

    if (!comparisonTime) {
      continue;
    }

    const ageMs = Date.now() - new Date(comparisonTime).getTime();

    if (!Number.isFinite(ageMs) || ageMs < cutoffMs) {
      continue;
    }

    const evidence = evidenceMetricsByClaimId.get(claim.id);
    const weakSupport =
      (evidence?.averageWeight ?? 0) < adaptiveProfile.rereviewAverageWeightFloor &&
      (evidence?.uniqueLineOrders ?? 0) <= 1 &&
      claim.sourceCount <= 1;

    if (!weakSupport) {
      continue;
    }

    registerCleanupAction(actionMap, {
      claim,
      decision: "deferred",
      nextStatus: "proposed",
      cleanupRule: "stale_low_support_rereview",
      priority: 78,
      reason: `Cleanup agent moved an aging low-support claim back to proposed so Lafz can re-review it when stronger evidence appears.`
    });
  }

  return actionMap;
}

function mergeCleanupActions(...actionSets: Map<string, CleanupAction>[]) {
  const merged = new Map<string, CleanupAction>();

  for (const actionSet of actionSets) {
    for (const action of actionSet.values()) {
      registerCleanupAction(merged, action);
    }
  }

  return [...merged.values()].sort((left, right) => right.priority - left.priority);
}

async function reconcileGraphForCleanupAction(action: CleanupAction, spotifyTrackId: string) {
  const songNodeId = getClaimSongNodeId(action.claim);

  if (!songNodeId) {
    return 0;
  }

  if (action.claim.claimType === "song_vocabulary_observation") {
    const termKey = normalizeBrainKey(getClaimTerm(action.claim));

    if (!termKey) {
      return 0;
    }

    const termNode = await readBrainNodeByTypeAndKey("term_surface", termKey);

    if (!termNode) {
      return 0;
    }

    return deactivateBrainEdge({
      edgeType: "song_uses_term_surface",
      sourceNodeId: songNodeId,
      targetNodeId: termNode.id,
      sourceSongId: songNodeId,
      reason: action.reason,
      metadata: {
        cleanupRule: action.cleanupRule,
        claimId: action.claim.id
      }
    });
  }

  if (action.claim.claimType === "song_motif_observation") {
    const motifNode = await readBrainNodeByTypeAndKey("motif", action.claim.normalizedKey);

    if (!motifNode) {
      return 0;
    }

    return deactivateBrainEdge({
      edgeType: "song_has_motif",
      sourceNodeId: songNodeId,
      targetNodeId: motifNode.id,
      sourceSongId: songNodeId,
      reason: action.reason,
      metadata: {
        cleanupRule: action.cleanupRule,
        claimId: action.claim.id
      }
    });
  }

  if (action.claim.claimType === "artist_motif_pattern_observation") {
    const artistKey = getClaimArtistOwnerKey(action.claim);
    const motifNode = await readBrainNodeByTypeAndKey("motif", action.claim.normalizedKey);
    const artistNode = artistKey ? await readBrainNodeByTypeAndKey("artist", artistKey) : null;

    if (!motifNode || !artistNode) {
      return 0;
    }

    return deactivateBrainEdge({
      edgeType: "artist_exhibits_motif",
      sourceNodeId: artistNode.id,
      targetNodeId: motifNode.id,
      reason: action.reason,
      metadata: {
        cleanupRule: action.cleanupRule,
        claimId: action.claim.id
      }
    });
  }

  if (action.claim.claimType === "artist_persona_style_observation") {
    const artistKey = getClaimArtistOwnerKey(action.claim);
    const personaNode = await readBrainNodeByTypeAndKey("persona_style", action.claim.normalizedKey);
    const artistNode = artistKey ? await readBrainNodeByTypeAndKey("artist", artistKey) : null;

    if (!personaNode || !artistNode) {
      return 0;
    }

    return deactivateBrainEdge({
      edgeType: "artist_has_persona_style",
      sourceNodeId: artistNode.id,
      targetNodeId: personaNode.id,
      reason: action.reason,
      metadata: {
        cleanupRule: action.cleanupRule,
        claimId: action.claim.id
      }
    });
  }

  if (action.claim.claimType === "song_symbol_observation") {
    const symbolNode = await readBrainNodeByTypeAndKey("symbol", action.claim.normalizedKey);

    if (!symbolNode) {
      return 0;
    }

    return deactivateBrainEdge({
      edgeType: "song_uses_symbol",
      sourceNodeId: songNodeId,
      targetNodeId: symbolNode.id,
      sourceSongId: songNodeId,
      reason: action.reason,
      metadata: {
        cleanupRule: action.cleanupRule,
        claimId: action.claim.id
      }
    });
  }

  if (action.claim.claimType === "song_relationship_observation") {
    const sourceEntity = getClaimSourceEntity(action.claim);
    const targetEntity = getClaimTargetEntity(action.claim);

    if (!sourceEntity || !targetEntity) {
      return 0;
    }

    const [sourceNode, targetNode] = await Promise.all([
      readBrainNodeByTypeAndKey("entity_instance", buildEntityInstanceKey(spotifyTrackId, sourceEntity)),
      readBrainNodeByTypeAndKey("entity_instance", buildEntityInstanceKey(spotifyTrackId, targetEntity))
    ]);

    if (!sourceNode || !targetNode) {
      return 0;
    }

    return deactivateBrainEdge({
      edgeType: "entity_instance_related_to_entity_instance",
      sourceNodeId: sourceNode.id,
      targetNodeId: targetNode.id,
      sourceSongId: songNodeId,
      reason: action.reason,
      metadata: {
        cleanupRule: action.cleanupRule,
        claimId: action.claim.id
      }
    });
  }

  if (action.claim.claimType === "artist_entity_role_observation") {
    const artistKey = getClaimArtistOwnerKey(action.claim);
    const entityKey = asString(action.claim.payload.entityKey);
    const entityRole = asString(action.claim.payload.entityRole);
    const roleKey = normalizeBrainKey(entityKey) ?? normalizeBrainKey(entityRole);

    if (!artistKey || !roleKey) {
      return 0;
    }

    const [artistNode, entityTypeNode] = await Promise.all([
      readBrainNodeByTypeAndKey("artist", artistKey),
      readBrainNodeByTypeAndKey("entity_type", roleKey)
    ]);

    if (!artistNode || !entityTypeNode) {
      return 0;
    }

    return deactivateBrainEdge({
      edgeType: "artist_associates_entity_type",
      sourceNodeId: artistNode.id,
      targetNodeId: entityTypeNode.id,
      reason: action.reason,
      metadata: {
        cleanupRule: action.cleanupRule,
        claimId: action.claim.id
      }
    });
  }

  if (action.claim.claimType === "artist_relationship_pattern_observation") {
    const artistKey = getClaimArtistOwnerKey(action.claim);
    const sourceRole = asString(action.claim.payload.sourceRole);
    const targetRole = asString(action.claim.payload.targetRole);
    const sourceEntityKey = asString(action.claim.payload.sourceEntityKey);
    const targetEntityKey = asString(action.claim.payload.targetEntityKey);

    if (!artistKey || !sourceRole || !targetRole) {
      return 0;
    }

    const [artistNode, sourceNode, targetNode] = await Promise.all([
      readBrainNodeByTypeAndKey("artist", artistKey),
      readBrainNodeByTypeAndKey("entity_type", normalizeBrainKey(sourceEntityKey) ?? normalizeBrainKey(sourceRole) ?? ""),
      readBrainNodeByTypeAndKey("entity_type", normalizeBrainKey(targetEntityKey) ?? normalizeBrainKey(targetRole) ?? "")
    ]);

    if (!artistNode || !sourceNode || !targetNode) {
      return 0;
    }

    return deactivateBrainEdge({
      edgeType: "entity_type_related_to_entity_type",
      sourceNodeId: sourceNode.id,
      targetNodeId: targetNode.id,
      sourceSongId: artistNode.id,
      reason: action.reason,
      metadata: {
        cleanupRule: action.cleanupRule,
        claimId: action.claim.id
      }
    });
  }

  return 0;
}

function isStaleCleanupAgentJob(row: StaleCleanupAgentJobRow, timeoutMs: number) {
  const heartbeatAt = row.last_heartbeat_at ?? row.claimed_at;

  if (!heartbeatAt) {
    return false;
  }

  const heartbeatTime = new Date(heartbeatAt).getTime();

  if (!Number.isFinite(heartbeatTime)) {
    return false;
  }

  return Date.now() - heartbeatTime >= timeoutMs;
}

async function reclaimStaleCleanupAgentJobs() {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return {
      reclaimed: 0,
      deadLettered: 0,
      sampleJobKeys: [] as string[]
    };
  }

  const timeoutMs = getCleanupAgentStaleJobTimeoutMs();
  const maxAttempts = getCleanupAgentMaxAttempts();
  const { data, error } = await supabase
    .from("agent_jobs")
    .select("id, job_key, attempt_count, claimed_by, claimed_at, last_heartbeat_at")
    .eq("job_type", "cleanup_agent")
    .in("status", ["claimed", "running"])
    .order("updated_at", { ascending: true })
    .limit(100);

  if (error) {
    console.error("[lafz-brain] could not scan stale cleanup jobs.", error);
    return {
      reclaimed: 0,
      deadLettered: 0,
      sampleJobKeys: [] as string[]
    };
  }

  const staleJobs = (data ?? [])
    .filter((row): row is StaleCleanupAgentJobRow => Boolean(row && typeof row.id === "string" && typeof row.job_key === "string"))
    .filter((row) => isStaleCleanupAgentJob(row, timeoutMs));

  if (staleJobs.length === 0) {
    return {
      reclaimed: 0,
      deadLettered: 0,
      sampleJobKeys: [] as string[]
    };
  }

  const now = new Date().toISOString();
  const staleMessage = `Recovered stale cleanup job after ${timeoutMs}ms without heartbeat.`;
  const sampleJobKeys: string[] = [];
  let reclaimed = 0;
  let deadLettered = 0;

  for (const job of staleJobs) {
    if (sampleJobKeys.length < 5) {
      sampleJobKeys.push(job.job_key);
    }

    const shouldDeadLetter = job.attempt_count >= maxAttempts;
    const nextStatus = shouldDeadLetter ? "dead_lettered" : "pending";

    const { error: jobError } = await supabase
      .from("agent_jobs")
      .update({
        status: nextStatus,
        claimed_by: null,
        claimed_at: null,
        last_heartbeat_at: shouldDeadLetter ? now : null,
        last_error: staleMessage,
        available_at: now,
        updated_at: now
      })
      .eq("id", job.id);

    if (jobError) {
      console.error("[lafz-brain] could not reclaim stale cleanup job.", {
        jobKey: job.job_key,
        error: jobError
      });
      continue;
    }

    const { error: runError } = await supabase
      .from("agent_runs")
      .update({
        status: "cancelled",
        error_text: staleMessage,
        finished_at: now,
        updated_at: now
      })
      .eq("job_id", job.id)
      .eq("agent_role", "cleanup_agent")
      .eq("status", "running");

    if (runError) {
      console.error("[lafz-brain] could not mark stale cleanup run as cancelled.", {
        jobKey: job.job_key,
        error: runError
      });
    }

    if (shouldDeadLetter) {
      deadLettered += 1;
    } else {
      reclaimed += 1;
    }
  }

  if (reclaimed > 0 || deadLettered > 0) {
    console.log("[lafz-brain] recovered stale cleanup jobs.", {
      timeoutMs,
      reclaimed,
      deadLettered,
      sampleJobKeys
    });
  }

  return {
    reclaimed,
    deadLettered,
    sampleJobKeys
  };
}

async function finalizeCleanupAgentFailureJob(options: {
  jobId: string;
  jobKey: string;
  workerId: string;
  shouldRetry: boolean;
  nextJobStatus: "pending" | "dead_lettered";
  nextAvailableAt: string | null;
  message: string;
}) {
  const patch = {
    workerId: options.shouldRetry ? null : options.workerId,
    heartbeat: true,
    lastError: options.message,
    availableAt: options.nextAvailableAt
  } as const;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const updated = await updateAgentJobStatus(options.jobId, options.nextJobStatus, patch);

    if (updated?.status === options.nextJobStatus) {
      return updated;
    }
  }

  const observed = await readAgentJobByKey(options.jobKey);

  if (observed?.status === options.nextJobStatus) {
    return observed;
  }

  console.warn("[lafz-brain] cleanup agent failure transition did not stick cleanly.", {
    jobKey: options.jobKey,
    expectedStatus: options.nextJobStatus,
    observedStatus: observed?.status ?? null
  });

  return observed;
}

function buildArtistKeysFromDraft(draftFile: AiTranslationDraftFile, payload: Record<string, unknown>) {
  const payloadArtistKeys = Array.isArray(payload.artistKeys)
    ? payload.artistKeys.map((value) => asString(value)).filter((value): value is string => Boolean(value))
    : [];

  if (payloadArtistKeys.length > 0) {
    return payloadArtistKeys;
  }

  return splitArtistCredits(draftFile.artist).map((credit) => credit.key);
}

async function processClaimedCleanupAgentJob(workerId: string): Promise<CleanupAgentRunSummary | null> {
  const job = await claimNextAgentJob(workerId, "cleanup_agent");

  if (!job) {
    return null;
  }

  const run = await insertAgentRun({
    jobId: job.id,
    agentRole: "cleanup_agent",
    workerId,
    input: {
      jobKey: job.jobKey,
      spotifyTrackId: job.spotifyTrackId,
      scopeKey: job.scopeKey
    }
  });

  let heartbeatInterval: NodeJS.Timeout | null = null;

  try {
    await updateAgentJobStatus(job.id, "running", {
      workerId,
      heartbeat: true,
      lastError: null
    });

    heartbeatInterval = setInterval(() => {
      void heartbeatAgentJob(job.id, workerId).catch((error) => {
        console.error("[lafz-brain] cleanup agent heartbeat failed.", {
          jobKey: job.jobKey,
          workerId,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, getCleanupAgentHeartbeatMs());
    heartbeatInterval.unref?.();

    const spotifyTrackId = job.spotifyTrackId;

    if (!spotifyTrackId) {
      throw new Error("Cleanup agent job is missing spotifyTrackId.");
    }

    const draftFile = await getAiTranslationDraftByTrackId(spotifyTrackId);

    if (!draftFile) {
      throw new Error(`Could not load draft for ${spotifyTrackId}.`);
    }

    const artistKeys = buildArtistKeysFromDraft(draftFile, job.payload);

    await heartbeatAgentJob(job.id, workerId);

    const [songClaims, artistClaims] = await Promise.all([
      listBrainClaimsByScope("song", [spotifyTrackId], 200),
      artistKeys.length > 0 ? listBrainClaimsByScope("artist", artistKeys, 200) : Promise.resolve([])
    ]);

    const candidateClaims = [...songClaims, ...artistClaims].filter(isCleanupClaimCandidate);
    const [promotions, evidenceRows] = await Promise.all([
      listBrainPromotionsByClaimIds(candidateClaims.map((claim) => claim.id)),
      listBrainEvidenceByClaimIds(candidateClaims.map((claim) => claim.id))
    ]);
    const evidenceMetricsByClaimId = buildEvidenceMetricsByClaimId(evidenceRows);
    const adaptiveProfile = buildAdaptiveCleanupProfile(candidateClaims, evidenceMetricsByClaimId);
    const embeddingByClaimId = await buildClaimEmbeddingMap(
      candidateClaims.filter(
        (claim) =>
          claim.claimType === "song_vocabulary_observation" ||
          claim.claimType === "artist_term_usage_observation" ||
          claim.claimType === "song_relationship_observation"
      )
    );
    const latestPromotionByClaimId = getLatestPromotionByClaimId(promotions);
    const actions = mergeCleanupActions(
      buildDuplicateCleanupActions(candidateClaims, evidenceMetricsByClaimId),
      buildSemanticVocabularyMergeActions(candidateClaims, evidenceMetricsByClaimId, embeddingByClaimId),
      buildContradictionCleanupActions(candidateClaims, evidenceMetricsByClaimId, embeddingByClaimId, adaptiveProfile),
      buildArtistSupersededActions(songClaims, artistClaims, evidenceMetricsByClaimId),
      buildImpliedInferenceActions(candidateClaims),
      buildRedundantExistingTermActions(candidateClaims),
      buildGenericPhraseActions(candidateClaims, evidenceMetricsByClaimId, adaptiveProfile),
      buildMotifCleanupActions(candidateClaims, evidenceMetricsByClaimId, adaptiveProfile),
      buildPersonaCleanupActions(candidateClaims, evidenceMetricsByClaimId, adaptiveProfile),
      buildSymbolCleanupActions(candidateClaims, evidenceMetricsByClaimId, adaptiveProfile),
      buildEntityRoleCleanupActions(candidateClaims, evidenceMetricsByClaimId),
      buildRelationshipCleanupActions(candidateClaims, evidenceMetricsByClaimId, adaptiveProfile),
      buildRelationshipConflictActions(candidateClaims, evidenceMetricsByClaimId, embeddingByClaimId, adaptiveProfile),
      buildStaleRereviewActions(candidateClaims, evidenceMetricsByClaimId, adaptiveProfile)
    );

    const output = {
      claimsReviewed: candidateClaims.length,
      actionsApplied: 0,
      rejected: 0,
      deprecated: 0,
      graphRepairsApplied: 0,
      duplicatesCollapsed: 0,
      reinforcementsTrimmed: 0,
      inferredClaimsRejected: 0,
      artistMergeTrimmed: 0,
      motifClaimsTrimmed: 0,
      personaClaimsTrimmed: 0,
      symbolClaimsTrimmed: 0,
      relationshipClaimsTrimmed: 0,
      materializedClaims: 0,
      materializedNodeTouches: 0,
      materializedEdgeTouches: 0,
      invalidatedMemoryPacks: 0,
      currentSongPackRefreshed: false
    };

    for (const action of actions) {
      const latest = latestPromotionByClaimId.get(action.claim.id);
      const latestPayload = isRecord(latest?.payload) ? latest.payload : {};

      if (
        latest?.decidedBy === "cleanup_agent" &&
        latest.decision === action.decision &&
        asString(latestPayload.cleanupRule) === action.cleanupRule &&
        asString(latestPayload.winnerClaimId) === (action.winnerClaimId ?? null)
      ) {
        continue;
      }

      const promotion = await insertBrainPromotion({
        claimId: action.claim.id,
        decision: action.decision,
        decidedBy: "cleanup_agent",
        reason: action.reason,
        payload: {
          cleanupRule: action.cleanupRule,
          nextStatus: action.nextStatus,
          winnerClaimId: action.winnerClaimId ?? null,
          claimType: action.claim.claimType,
          term: getClaimTerm(action.claim),
          meaning: getClaimMeaning(action.claim),
          confidenceScore: action.claim.confidenceScore,
          evidenceCount: action.claim.evidenceCount,
          sourceCount: action.claim.sourceCount
        }
      });

      if (!promotion) {
        continue;
      }

      const existingCleanup = isRecord(action.claim.payload.cleanup) ? action.claim.payload.cleanup : {};
      const nextDecayCount =
        action.cleanupRule === "stale_low_support_rereview"
          ? (typeof existingCleanup.decayCount === "number" ? existingCleanup.decayCount : 0) + 1
          : typeof existingCleanup.decayCount === "number"
            ? existingCleanup.decayCount
            : 0;

      const cleanupPayload = {
        cleanup: {
          ...existingCleanup,
          lastRule: action.cleanupRule,
          lastDecision: action.decision,
          lastReason: action.reason,
          lastReviewAt: new Date().toISOString(),
          winnerClaimId: action.winnerClaimId ?? null,
          decayCount: nextDecayCount,
          needsRereview: action.nextStatus === "proposed"
        }
      };

      if (action.nextStatus === "deprecated") {
        await updateBrainClaim({
          claimId: action.claim.id,
          status: "deprecated",
          payloadMerge: cleanupPayload
        });
        output.deprecated += 1;
      } else if (action.nextStatus === "proposed") {
        await updateBrainClaim({
          claimId: action.claim.id,
          status: "proposed",
          payloadMerge: cleanupPayload
        });
      } else {
        await updateBrainClaim({
          claimId: action.claim.id,
          payloadMerge: cleanupPayload
        });
        output.rejected += 1;
      }

      output.graphRepairsApplied += await reconcileGraphForCleanupAction(action, spotifyTrackId);

      if (action.cleanupRule === "duplicate_term_variant") {
        output.duplicatesCollapsed += 1;
      }

      if (action.cleanupRule === "redundant_existing_term") {
        output.reinforcementsTrimmed += 1;
      }

      if (action.cleanupRule === "implied_not_explicit") {
        output.inferredClaimsRejected += 1;
      }

      if (action.cleanupRule === "superseded_by_artist_memory") {
        output.artistMergeTrimmed += 1;
      }

      if (action.claim.claimType === "song_motif_observation") {
        output.motifClaimsTrimmed += 1;
      }

      if (action.claim.claimType === "artist_persona_style_observation") {
        output.personaClaimsTrimmed += 1;
      }

      if (action.claim.claimType === "song_symbol_observation") {
        output.symbolClaimsTrimmed += 1;
      }

      if (
        action.claim.claimType === "song_relationship_observation" ||
        action.claim.claimType === "artist_relationship_pattern_observation"
      ) {
        output.relationshipClaimsTrimmed += 1;
      }

      output.actionsApplied += 1;
    }

    const materialization = await materializeAcceptedVocabularyClaims({
      draftFile
    });
    output.materializedClaims += materialization.claimsMaterialized;
    output.materializedNodeTouches += materialization.nodeTouches;
    output.materializedEdgeTouches += materialization.edgeTouches;
    output.invalidatedMemoryPacks += materialization.invalidatedMemoryPacks;
    output.currentSongPackRefreshed = output.currentSongPackRefreshed || materialization.currentSongPackRefreshed;

    const entityMaterialization = await materializeAcceptedEntityClaims({
      draftFile
    });
    output.materializedClaims += entityMaterialization.claimsMaterialized;
    output.materializedNodeTouches += entityMaterialization.nodeTouches;
    output.materializedEdgeTouches += entityMaterialization.edgeTouches;
    output.invalidatedMemoryPacks += entityMaterialization.invalidatedMemoryPacks;
    output.currentSongPackRefreshed = output.currentSongPackRefreshed || entityMaterialization.currentSongPackRefreshed;

    const motifMaterialization = await materializeAcceptedMotifClaims({
      draftFile
    });
    output.materializedClaims += motifMaterialization.claimsMaterialized;
    output.materializedNodeTouches += motifMaterialization.nodeTouches;
    output.materializedEdgeTouches += motifMaterialization.edgeTouches;
    output.invalidatedMemoryPacks += motifMaterialization.invalidatedMemoryPacks;
    output.currentSongPackRefreshed = output.currentSongPackRefreshed || motifMaterialization.currentSongPackRefreshed;

    const personaMaterialization = await materializeAcceptedPersonaClaims({
      draftFile
    });
    output.materializedClaims += personaMaterialization.claimsMaterialized;
    output.materializedNodeTouches += personaMaterialization.nodeTouches;
    output.materializedEdgeTouches += personaMaterialization.edgeTouches;
    output.invalidatedMemoryPacks += personaMaterialization.invalidatedMemoryPacks;
    output.currentSongPackRefreshed = output.currentSongPackRefreshed || personaMaterialization.currentSongPackRefreshed;

    if (output.actionsApplied > 0 && !output.currentSongPackRefreshed) {
      await buildSongTranslationMemoryPack({
        spotifyTrackId,
        artist: draftFile.artist,
        candidateTexts: draftFile.lines.slice(0, 24).map((line) => line.original),
        forceRefresh: true
      }).catch(() => null);
    }

    if (run) {
      await updateAgentRun(run.id, {
        status: "completed",
        output
      });
    }

    await updateAgentJobStatus(job.id, "completed", {
      workerId,
      heartbeat: true,
      lastError: null
    });

    return {
      jobId: job.id,
      jobKey: job.jobKey,
      spotifyTrackId,
      ...output
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown cleanup-agent error.";
    const maxAttempts = getCleanupAgentMaxAttempts();
    const shouldRetry = job.attemptCount < maxAttempts;
    const retryDelayMs = shouldRetry ? computeCleanupAgentRetryDelayMs(job.attemptCount) : 0;
    const nextAvailableAt = shouldRetry ? new Date(Date.now() + retryDelayMs).toISOString() : null;
    const nextJobStatus = shouldRetry ? "pending" : "dead_lettered";

    if (run) {
      await updateAgentRun(run.id, {
        status: "failed",
        errorText: message,
        output: {
          retryScheduled: shouldRetry,
          nextAttemptAt: nextAvailableAt,
          attemptCount: job.attemptCount,
          maxAttempts
        }
      });
    }

    await finalizeCleanupAgentFailureJob({
      jobId: job.id,
      jobKey: job.jobKey,
      workerId,
      shouldRetry,
      nextJobStatus,
      nextAvailableAt,
      message
    });

    console.error("[lafz-brain] cleanup agent job failed.", {
      jobKey: job.jobKey,
      spotifyTrackId: job.spotifyTrackId,
      error: message,
      willRetry: shouldRetry,
      attemptCount: job.attemptCount,
      maxAttempts,
      nextAttemptAt: nextAvailableAt
    });

    return {
      jobId: job.id,
      jobKey: job.jobKey,
      spotifyTrackId: job.spotifyTrackId ?? "",
      claimsReviewed: 0,
      actionsApplied: 0,
      rejected: 0,
      deprecated: 0,
      graphRepairsApplied: 0,
      duplicatesCollapsed: 0,
      reinforcementsTrimmed: 0,
      inferredClaimsRejected: 0,
      artistMergeTrimmed: 0,
      motifClaimsTrimmed: 0,
      personaClaimsTrimmed: 0,
      symbolClaimsTrimmed: 0,
      relationshipClaimsTrimmed: 0,
      materializedClaims: 0,
      materializedNodeTouches: 0,
      materializedEdgeTouches: 0,
      invalidatedMemoryPacks: 0,
      currentSongPackRefreshed: false
    };
  } finally {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
  }
}

async function refillCleanupBacklogIfIdle() {
  if (!isCleanupBacklogAutoRefillEnabled()) {
    return 0;
  }

  const globals = getCleanupAgentGlobals();
  const cooldownMs = getCleanupBacklogRefillCooldownMs();
  const lastRefillAt = globals.__lafzCleanupAgentLastBacklogRefillAt
    ? new Date(globals.__lafzCleanupAgentLastBacklogRefillAt).getTime()
    : 0;

  if (Date.now() - lastRefillAt < cooldownMs) {
    return 0;
  }

  const hasActiveJobs = await hasActiveCleanupAgentJobs();

  if (hasActiveJobs) {
    return 0;
  }

  const result = await enqueueCleanupBacklogBatch();
  globals.__lafzCleanupAgentLastBacklogRefillAt = new Date().toISOString();
  globals.__lafzCleanupAgentLastBacklogRefillResult = result;

  if (result.enqueued > 0) {
    console.log("[lafz-brain] cleanup backlog refill queued jobs.", {
      enqueued: result.enqueued,
      candidatesFound: result.candidatesFound,
      exhausted: result.exhausted,
      sampleJobKeys: result.sampleJobKeys
    });
  }

  return result.enqueued;
}

export async function runNextCleanupAgentJob(options?: {
  ignoreMode?: boolean;
  workerId?: string | null;
}) {
  if (!options?.ignoreMode && !isCleanupAgentEmbeddedMode()) {
    return null;
  }

  await reclaimStaleCleanupAgentJobs();

  const workerId = options?.workerId?.trim() || getCleanupAgentWorkerId(options?.ignoreMode ? "lafz-standalone-cleanup-worker" : "lafz-cleanup-worker");
  const globals = getCleanupAgentGlobals();
  const summary = await processClaimedCleanupAgentJob(workerId);

  if (summary) {
    globals.__lafzCleanupAgentLastActivityAt = new Date().toISOString();
    globals.__lafzCleanupAgentLastSummary = summary;
  }

  return summary;
}

export async function runCleanupAgentUntilIdle(options?: {
  ignoreMode?: boolean;
  workerId?: string | null;
  reason?: string;
  maxJobs?: number | null;
}) {
  const globals = getCleanupAgentGlobals();
  const reason = options?.reason ?? "manual";
  globals.__lafzCleanupAgentLastKickReason = reason;

  const processed: CleanupAgentRunSummary[] = [];

  while (true) {
    if (options?.maxJobs && processed.length >= options.maxJobs) {
      break;
    }

    const summary = await runNextCleanupAgentJob(options);

    if (!summary) {
      const refilled = await refillCleanupBacklogIfIdle();

      if (refilled > 0) {
        continue;
      }

      break;
    }

    processed.push(summary);

    console.log("[lafz-brain] cleanup agent processed job.", {
      reason,
      jobKey: summary.jobKey,
      spotifyTrackId: summary.spotifyTrackId,
      claimsReviewed: summary.claimsReviewed,
      actionsApplied: summary.actionsApplied,
      rejected: summary.rejected,
      deprecated: summary.deprecated
    });
  }

  return processed;
}

export function kickCleanupAgentWorker(reason = "manual") {
  if (!isCleanupAgentEmbeddedMode()) {
    return;
  }

  const globals = getCleanupAgentGlobals();

  if (globals.__lafzCleanupAgentInFlight) {
    return;
  }

  globals.__lafzCleanupAgentInFlight = (async () => {
    try {
      await runCleanupAgentUntilIdle({ reason });
    } finally {
      globals.__lafzCleanupAgentInFlight = null;

      void hasActiveCleanupAgentJobs()
        .then((hasActiveJobs) => {
          if (!hasActiveJobs) {
            return;
          }

          setTimeout(() => {
            kickCleanupAgentWorker("drain-pending");
          }, 0);
        })
        .catch((error) => {
          console.error("[lafz-brain] cleanup agent could not check for pending jobs after a run.", error);
        });
    }
  })();
}

export function ensureCleanupAgentWorkerStarted() {
  if (!isCleanupAgentEmbeddedMode()) {
    return;
  }

  const globals = getCleanupAgentGlobals();

  if (!globals.__lafzCleanupAgentStartedAt) {
    globals.__lafzCleanupAgentStartedAt = new Date().toISOString();
  }

  if (!globals.__lafzCleanupAgentInterval) {
    globals.__lafzCleanupAgentInterval = setInterval(() => {
      kickCleanupAgentWorker("interval");
    }, getCleanupAgentPollMs());
  }

  kickCleanupAgentWorker("startup");
}

export function getCleanupAgentProcessStatus() {
  const globals = getCleanupAgentGlobals();

  return {
    runtimeMode: getCleanupAgentRuntimeMode(),
    workerId: getCleanupAgentWorkerId(),
    pollMs: getCleanupAgentPollMs(),
    autoBacklogEnabled: isCleanupBacklogAutoRefillEnabled(),
    staleJobTimeoutMs: getCleanupAgentStaleJobTimeoutMs(),
    startedAt: globals.__lafzCleanupAgentStartedAt ?? null,
    lastKickReason: globals.__lafzCleanupAgentLastKickReason ?? null,
    lastActivityAt: globals.__lafzCleanupAgentLastActivityAt ?? null,
    lastBacklogRefillAt: globals.__lafzCleanupAgentLastBacklogRefillAt ?? null,
    lastBacklogRefillResult: globals.__lafzCleanupAgentLastBacklogRefillResult ?? null,
    inFlight: Boolean(globals.__lafzCleanupAgentInFlight),
    intervalActive: Boolean(globals.__lafzCleanupAgentInterval),
    lastSummary: globals.__lafzCleanupAgentLastSummary ?? null
  };
}
