import { evaluateBrainClaimReview, shouldQueueBrainClaimReview } from "./review.ts";
import type {
  LafzBrainCriticEvalCase,
  LafzBrainCriticEvalCaseResult,
  LafzBrainCriticEvalExpectation,
  LafzBrainCriticEvalSet,
  LafzBrainCriticEvaluationReport,
  LafzBrainReviewBand,
  LafzBrainReviewRecommendation
} from "./types.ts";

function createEmptyBandCounts(): Record<LafzBrainReviewBand, number> {
  return {
    high: 0,
    medium: 0,
    low: 0
  };
}

function createEmptyRecommendationCounts(): Record<LafzBrainReviewRecommendation, number> {
  return {
    review_now: 0,
    review_soon: 0,
    monitor: 0
  };
}

function normalizeBooleanLabel(value: boolean) {
  return value ? "yes" : "no";
}

function buildMismatchList(
  expected: LafzBrainCriticEvalExpectation,
  actual: LafzBrainCriticEvalCaseResult["actual"]
) {
  const mismatches: string[] = [];

  if (expected.reviewBand !== actual.reviewBand) {
    mismatches.push(`reviewBand expected ${expected.reviewBand} but got ${actual.reviewBand}`);
  }

  if (expected.reviewRecommendation !== actual.reviewRecommendation) {
    mismatches.push(
      `reviewRecommendation expected ${expected.reviewRecommendation} but got ${actual.reviewRecommendation}`
    );
  }

  if (expected.shouldQueue !== actual.shouldQueue) {
    mismatches.push(
      `shouldQueue expected ${normalizeBooleanLabel(expected.shouldQueue)} but got ${normalizeBooleanLabel(actual.shouldQueue)}`
    );
  }

  return mismatches;
}

export function evaluateBrainCriticCase(entry: LafzBrainCriticEvalCase): LafzBrainCriticEvalCaseResult {
  const evaluation = evaluateBrainClaimReview(entry.input);
  const shouldQueue = shouldQueueBrainClaimReview(entry.input, evaluation);
  const actual = {
    reviewScore: evaluation.reviewScore,
    reviewBand: evaluation.reviewBand,
    reviewRecommendation: evaluation.reviewRecommendation,
    shouldQueue,
    reasons: evaluation.reasons
  };
  const mismatches = buildMismatchList(entry.expected, actual);

  return {
    id: entry.id,
    description: entry.description,
    claimType: entry.input.claim.claimType,
    scopeType: entry.input.claim.scopeType,
    claimKey: entry.input.claim.claimKey,
    expected: entry.expected,
    actual,
    mismatches,
    passed: mismatches.length === 0
  };
}

export function buildBrainCriticEvaluationReport(input: LafzBrainCriticEvalSet): LafzBrainCriticEvaluationReport {
  const cases = input.cases.map((entry) => evaluateBrainCriticCase(entry));
  const bandCounts = createEmptyBandCounts();
  const recommendationCounts = createEmptyRecommendationCounts();
  const queueCounts = { queued: 0, skipped: 0 };

  let reviewBandMatches = 0;
  let reviewRecommendationMatches = 0;
  let queueMatches = 0;

  for (const entry of cases) {
    bandCounts[entry.actual.reviewBand] += 1;
    recommendationCounts[entry.actual.reviewRecommendation] += 1;
    entry.actual.shouldQueue ? queueCounts.queued += 1 : queueCounts.skipped += 1;

    if (entry.expected.reviewBand === entry.actual.reviewBand) {
      reviewBandMatches += 1;
    }

    if (entry.expected.reviewRecommendation === entry.actual.reviewRecommendation) {
      reviewRecommendationMatches += 1;
    }

    if (entry.expected.shouldQueue === entry.actual.shouldQueue) {
      queueMatches += 1;
    }
  }

  const passedCases = cases.filter((entry) => entry.passed).length;
  const failedCases = cases.length - passedCases;
  const failures = cases
    .filter((entry) => !entry.passed)
    .sort((left, right) => {
      if (right.mismatches.length !== left.mismatches.length) {
        return right.mismatches.length - left.mismatches.length;
      }

      return right.actual.reviewScore - left.actual.reviewScore;
    });

  const totalCases = cases.length;
  const denominator = totalCases > 0 ? totalCases : 1;

  return {
    version: input.version,
    description: input.description,
    generatedAt: new Date().toISOString(),
    totalCases,
    passedCases,
    failedCases,
    reviewBandMatches,
    reviewRecommendationMatches,
    queueMatches,
    reviewBandAccuracy: reviewBandMatches / denominator,
    reviewRecommendationAccuracy: reviewRecommendationMatches / denominator,
    queueAccuracy: queueMatches / denominator,
    passRate: passedCases / denominator,
    bandCounts,
    recommendationCounts,
    queueCounts,
    topFailures: failures.slice(0, 5),
    cases
  };
}
