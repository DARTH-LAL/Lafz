import type {
  LafzBrainClaimRecord,
  LafzBrainClaimScopeType,
  LafzBrainClaimStatus,
  LafzBrainClaimType,
  LafzBrainLearningProfileRecord,
  LafzBrainPromotionDecision,
  LafzBrainPromotionRecord
} from "@/features/brain/types";

export type BrainReviewBand = "high" | "medium" | "low";

export type BrainReviewRecommendation = "review_now" | "review_soon" | "monitor";

export type BrainClaimReviewItem = {
  claimId: string;
  claimKey: string;
  claimType: LafzBrainClaimType;
  scopeType: LafzBrainClaimScopeType;
  scopeKey: string;
  normalizedKey: string;
  status: LafzBrainClaimStatus;
  confidenceScore: number;
  sourceCount: number;
  evidenceCount: number;
  updatedAt: string | null;
  reviewScore: number;
  reviewBand: BrainReviewBand;
  reviewRecommendation: BrainReviewRecommendation;
  reasons: string[];
  learningBias: number;
  learningSignalCount: number;
  latestDecision: LafzBrainPromotionDecision | null;
  latestDecidedBy: string | null;
  latestDecisionAt: string | null;
  manualLocked: boolean;
  cleanupLocked: boolean;
  needsRereview: boolean;
  decayCount: number;
  lastCleanupRule: string | null;
};

export type BrainReviewSummary = {
  reviewableCount: number;
  reviewNowCount: number;
  reviewSoonCount: number;
  monitorCount: number;
  acceptedCount: number;
  proposedCount: number;
  rejectedCount: number;
  deprecatedCount: number;
  lockedCount: number;
  needsRereviewCount: number;
  averageReviewScore: number;
};

export type BrainReviewQueueResult = {
  reviewQueue: BrainClaimReviewItem[];
  reviewSummary: BrainReviewSummary;
};

type UnknownRecord = Record<string, unknown>;

export type BrainClaimReviewClaim = Pick<
  LafzBrainClaimRecord,
  | "id"
  | "claimKey"
  | "claimType"
  | "scopeType"
  | "scopeKey"
  | "normalizedKey"
  | "status"
  | "confidenceScore"
  | "sourceCount"
  | "evidenceCount"
  | "updatedAt"
  | "payload"
>;

export type BrainClaimReviewPromotion = Pick<
  LafzBrainPromotionRecord,
  "decision" | "decidedBy" | "createdAt"
>;

export type BrainClaimReviewLearningProfile = Pick<
  LafzBrainLearningProfileRecord,
  "confidenceBias" | "signalCount"
>;

export type BrainClaimReviewInput = {
  claim: BrainClaimReviewClaim;
  latestPromotion?: BrainClaimReviewPromotion | null;
  learningProfile?: BrainClaimReviewLearningProfile | null;
};

export type BrainClaimReviewEvaluation = {
  reviewScore: number;
  reviewBand: BrainReviewBand;
  reviewRecommendation: BrainReviewRecommendation;
  reasons: string[];
  learningBias: number;
  learningSignalCount: number;
  manualLocked: boolean;
  cleanupLocked: boolean;
  needsRereview: boolean;
  decayCount: number;
  lastCleanupRule: string | null;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(1, value));
}

function formatCountLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatSignedScore(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}`;
}

function getClaimCleanupPayload(claim: Pick<LafzBrainClaimRecord, "payload">) {
  return isRecord(claim.payload.cleanup) ? (claim.payload.cleanup as UnknownRecord) : {};
}

function getClaimManualPayload(claim: Pick<LafzBrainClaimRecord, "payload">) {
  return isRecord(claim.payload.manual) ? (claim.payload.manual as UnknownRecord) : {};
}

function getLatestPromotionByClaimId(promotions: LafzBrainPromotionRecord[]) {
  const latestPromotionByClaimId = new Map<string, LafzBrainPromotionRecord>();

  for (const promotion of promotions) {
    if (!latestPromotionByClaimId.has(promotion.claimId)) {
      latestPromotionByClaimId.set(promotion.claimId, promotion);
    }
  }

  return latestPromotionByClaimId;
}

function buildLearningProfileMap(learningProfiles: LafzBrainLearningProfileRecord[]) {
  const map = new Map<string, LafzBrainLearningProfileRecord>();

  for (const profile of learningProfiles) {
    map.set([profile.scopeType, profile.claimType, profile.normalizedKey].join("::"), profile);
  }

  return map;
}

function scoreReviewSignal(score: number, delta: number, reasons: string[], reason: string) {
  if (delta <= 0) {
    return clampScore(score + delta);
  }

  reasons.push(reason);
  return clampScore(score + delta);
}

export function evaluateBrainClaimReview(input: BrainClaimReviewInput): BrainClaimReviewEvaluation {
  const { claim, latestPromotion, learningProfile } = input;
  const cleanup = getClaimCleanupPayload(claim);
  const manual = getClaimManualPayload(claim);
  const manualLocked = manual.locked === true;
  const cleanupLocked = cleanup.locked === true;
  const needsRereview = cleanup.needsRereview === true;
  const decayCount = asNumber(cleanup.decayCount, 0);
  const lastCleanupRule = asString(cleanup.lastRule);
  const learningBias = learningProfile?.confidenceBias ?? 0;
  const learningSignalCount = learningProfile?.signalCount ?? 0;
  const reasons: string[] = [];
  let score = 0;

  if (claim.status === "proposed") {
    score = scoreReviewSignal(score, 0.2, reasons, "Still awaiting a final decision.");
  } else if (claim.status === "accepted") {
    score = scoreReviewSignal(score, 0.04, reasons, "Already accepted, but still worth auditing.");
  }

  if (latestPromotion?.decision === "deferred") {
    score = scoreReviewSignal(score, 0.18, reasons, "Cleanup deferred this claim before.");
  }

  if (latestPromotion?.decision === "rejected") {
    score = scoreReviewSignal(score, 0.12, reasons, "Cleanup previously rejected this claim.");
  }

  if (needsRereview) {
    score = scoreReviewSignal(score, 0.26, reasons, "Cleanup marked this claim for re-review.");
  }

  if (claim.confidenceScore < 0.6) {
    const lowConfidenceDelta = 0.12 + (0.6 - claim.confidenceScore) * 0.22;
    score = scoreReviewSignal(
      score,
      lowConfidenceDelta,
      reasons,
      `Low confidence (${claim.confidenceScore.toFixed(2)}).`
    );
  }

  if (claim.evidenceCount <= 1) {
    score = scoreReviewSignal(
      score,
      0.12,
      reasons,
      formatCountLabel(claim.evidenceCount, "evidence item") + " only."
    );
  } else if (claim.evidenceCount <= 2) {
    score = scoreReviewSignal(
      score,
      0.08,
      reasons,
      `${claim.evidenceCount} evidence items, still fairly thin.`
    );
  }

  if (claim.sourceCount <= 1) {
    score = scoreReviewSignal(
      score,
      0.08,
      reasons,
      formatCountLabel(claim.sourceCount, "source") + " only."
    );
  }

  if (decayCount > 0) {
    score = scoreReviewSignal(
      score,
      Math.min(0.16, 0.05 + decayCount * 0.03),
      reasons,
      decayCount === 1
        ? "Cleanup has already decayed this claim once."
        : `Cleanup has already decayed this claim ${decayCount} times.`
    );
  }

  if (learningProfile && learningSignalCount <= 2) {
    score = scoreReviewSignal(
      score,
      0.05,
      reasons,
      learningSignalCount === 1
        ? "The learning profile only has one prior signal."
        : "The learning profile is still lightly trained."
    );
  }

  if (learningBias < 0) {
    score = scoreReviewSignal(
      score,
      Math.min(0.15, Math.abs(learningBias) * 0.2),
      reasons,
      `Past feedback trends negative (${formatSignedScore(learningBias)} bias).`
    );
  } else if (learningBias > 0.08) {
    score = clampScore(score - Math.min(0.12, learningBias * 0.12));
  }

  if (claim.status === "accepted" && claim.evidenceCount >= 3 && claim.confidenceScore >= 0.82) {
    score = clampScore(score - 0.2);
  }

  if (manualLocked || cleanupLocked) {
    score = clampScore(score - 0.2);
  }

  if (claim.status === "rejected" || claim.status === "deprecated") {
    score = clampScore(score - 0.18);
  }

  if (reasons.length === 0) {
    reasons.push("No strong critic signal yet.");
  }

  const reviewScore = clampScore(score);
  const reviewBand: BrainReviewBand =
    reviewScore >= 0.72 ? "high" : reviewScore >= 0.48 ? "medium" : "low";

  const reviewRecommendation: BrainReviewRecommendation =
    reviewBand === "high" ? "review_now" : reviewBand === "medium" ? "review_soon" : "monitor";

  return {
    reviewScore,
    reviewBand,
    reviewRecommendation,
    reasons,
    manualLocked,
    cleanupLocked,
    needsRereview,
    decayCount,
    lastCleanupRule,
    learningBias,
    learningSignalCount
  };
}

export function shouldQueueBrainClaimReview(
  input: BrainClaimReviewInput,
  evaluation: BrainClaimReviewEvaluation = evaluateBrainClaimReview(input)
) {
  if (input.claim.status === "rejected" || input.claim.status === "deprecated") {
    return false;
  }

  if (evaluation.manualLocked || evaluation.cleanupLocked) {
    return false;
  }

  return (
    evaluation.reviewScore >= 0.38 ||
    evaluation.needsRereview ||
    input.latestPromotion?.decision === "deferred" ||
    input.latestPromotion?.decision === "rejected" ||
    input.claim.status === "proposed"
  );
}

export function buildBrainClaimReviewQueue(input: {
  claims: LafzBrainClaimRecord[];
  promotions: LafzBrainPromotionRecord[];
  learningProfiles: LafzBrainLearningProfileRecord[];
}): BrainReviewQueueResult {
  const latestPromotionByClaimId = getLatestPromotionByClaimId(input.promotions);
  const learningProfileByKey = buildLearningProfileMap(input.learningProfiles);
  const reviewQueue: BrainClaimReviewItem[] = [];

  for (const claim of input.claims) {
    if (claim.status === "rejected" || claim.status === "deprecated") {
      continue;
    }

    const latestPromotion = latestPromotionByClaimId.get(claim.id) ?? null;
    const learningProfile = learningProfileByKey.get([claim.scopeType, claim.claimType, claim.normalizedKey].join("::")) ?? null;
    const evaluated = evaluateBrainClaimReview({
      claim,
      latestPromotion,
      learningProfile
    });

    if (shouldQueueBrainClaimReview({ claim, latestPromotion, learningProfile }, evaluated)) {
      reviewQueue.push({
        claimId: claim.id,
        claimKey: claim.claimKey,
        claimType: claim.claimType,
        scopeType: claim.scopeType,
        scopeKey: claim.scopeKey,
        normalizedKey: claim.normalizedKey,
        status: claim.status,
        confidenceScore: claim.confidenceScore,
        sourceCount: claim.sourceCount,
        evidenceCount: claim.evidenceCount,
        updatedAt: claim.updatedAt,
        reviewScore: evaluated.reviewScore,
        reviewBand: evaluated.reviewBand,
        reviewRecommendation: evaluated.reviewRecommendation,
        reasons: evaluated.reasons,
        learningBias: evaluated.learningBias,
        learningSignalCount: evaluated.learningSignalCount,
        latestDecision: latestPromotion?.decision ?? null,
        latestDecidedBy: latestPromotion?.decidedBy ?? null,
        latestDecisionAt: latestPromotion?.createdAt ?? null,
        manualLocked: evaluated.manualLocked,
        cleanupLocked: evaluated.cleanupLocked,
        needsRereview: evaluated.needsRereview,
        decayCount: evaluated.decayCount,
        lastCleanupRule: evaluated.lastCleanupRule
      });
    }
  }

  reviewQueue.sort((left, right) => {
    if (right.reviewScore !== left.reviewScore) {
      return right.reviewScore - left.reviewScore;
    }

    const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
    const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;

    return rightTime - leftTime;
  });

  const summary = reviewQueue.reduce<BrainReviewSummary>(
    (totals, item) => {
      totals.reviewableCount += 1;
      totals.acceptedCount += item.status === "accepted" ? 1 : 0;
      totals.proposedCount += item.status === "proposed" ? 1 : 0;
      totals.rejectedCount += item.status === "rejected" ? 1 : 0;
      totals.deprecatedCount += item.status === "deprecated" ? 1 : 0;
      totals.lockedCount += item.manualLocked || item.cleanupLocked ? 1 : 0;
      totals.needsRereviewCount += item.needsRereview ? 1 : 0;
      totals.averageReviewScore += item.reviewScore;

      if (item.reviewBand === "high") {
        totals.reviewNowCount += 1;
      } else if (item.reviewBand === "medium") {
        totals.reviewSoonCount += 1;
      } else {
        totals.monitorCount += 1;
      }

      return totals;
    },
    {
      reviewableCount: 0,
      reviewNowCount: 0,
      reviewSoonCount: 0,
      monitorCount: 0,
      acceptedCount: 0,
      proposedCount: 0,
      rejectedCount: 0,
      deprecatedCount: 0,
      lockedCount: 0,
      needsRereviewCount: 0,
      averageReviewScore: 0
    }
  );

  if (summary.reviewableCount > 0) {
    summary.averageReviewScore /= summary.reviewableCount;
  }

  return {
    reviewQueue,
    reviewSummary: summary
  };
}
