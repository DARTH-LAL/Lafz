import type { AiTranslationConfidence } from "./types.ts";
import { evaluateSurfacePolishCandidate, type SurfacePolishCandidateInput } from "./surface-polish.ts";

export type LafzSurfacePolishEvalExpectation = {
  eligible: boolean;
  applied: boolean;
  chosen: string;
  confidence: AiTranslationConfidence;
};

export type LafzSurfacePolishEvalCase = {
  id: string;
  description: string;
  input: SurfacePolishCandidateInput;
  expected: LafzSurfacePolishEvalExpectation;
};

export type LafzSurfacePolishEvalCaseResult = {
  id: string;
  description: string;
  expected: LafzSurfacePolishEvalExpectation;
  actual: {
    eligible: boolean;
    applied: boolean;
    chosen: string;
    confidence: AiTranslationConfidence;
    reason: string | null;
  };
  mismatches: string[];
  passed: boolean;
};

export type LafzSurfacePolishEvalSet = {
  version: number;
  description: string;
  cases: LafzSurfacePolishEvalCase[];
};

export type LafzSurfacePolishEvaluationReport = {
  version: number;
  description: string;
  generatedAt: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  eligibleMatches: number;
  appliedMatches: number;
  chosenMatches: number;
  confidenceMatches: number;
  eligibleAccuracy: number;
  appliedAccuracy: number;
  chosenAccuracy: number;
  confidenceAccuracy: number;
  passRate: number;
  decisionCounts: {
    applied: number;
    rejected: number;
  };
  confidenceCounts: Record<AiTranslationConfidence, number>;
  topFailures: LafzSurfacePolishEvalCaseResult[];
  cases: LafzSurfacePolishEvalCaseResult[];
};

function createEmptyConfidenceCounts(): Record<AiTranslationConfidence, number> {
  return {
    high: 0,
    medium: 0,
    low: 0
  };
}

function buildMismatchList(
  expected: LafzSurfacePolishEvalExpectation,
  actual: LafzSurfacePolishEvalCaseResult["actual"]
) {
  const mismatches: string[] = [];

  if (expected.eligible !== actual.eligible) {
    mismatches.push(`eligible expected ${expected.eligible ? "yes" : "no"} but got ${actual.eligible ? "yes" : "no"}`);
  }

  if (expected.applied !== actual.applied) {
    mismatches.push(`applied expected ${expected.applied ? "yes" : "no"} but got ${actual.applied ? "yes" : "no"}`);
  }

  if (expected.chosen !== actual.chosen) {
    mismatches.push(`chosen expected "${expected.chosen}" but got "${actual.chosen}"`);
  }

  if (expected.confidence !== actual.confidence) {
    mismatches.push(`confidence expected ${expected.confidence} but got ${actual.confidence}`);
  }

  return mismatches;
}

export function evaluateSurfacePolishCase(entry: LafzSurfacePolishEvalCase): LafzSurfacePolishEvalCaseResult {
  const evaluation = evaluateSurfacePolishCandidate(entry.input);
  const actual = {
    eligible: evaluation.eligible,
    applied: evaluation.applied,
    chosen: evaluation.line.chosen,
    confidence: evaluation.line.confidence,
    reason: evaluation.reason
  };
  const mismatches = buildMismatchList(entry.expected, actual);

  return {
    id: entry.id,
    description: entry.description,
    expected: entry.expected,
    actual,
    mismatches,
    passed: mismatches.length === 0
  };
}

export function buildSurfacePolishEvaluationReport(input: LafzSurfacePolishEvalSet): LafzSurfacePolishEvaluationReport {
  const cases = input.cases.map((entry) => evaluateSurfacePolishCase(entry));
  const confidenceCounts = createEmptyConfidenceCounts();
  const decisionCounts = { applied: 0, rejected: 0 };

  let eligibleMatches = 0;
  let appliedMatches = 0;
  let chosenMatches = 0;
  let confidenceMatches = 0;

  for (const entry of cases) {
    confidenceCounts[entry.actual.confidence] += 1;
    entry.actual.applied ? decisionCounts.applied += 1 : decisionCounts.rejected += 1;

    if (entry.expected.eligible === entry.actual.eligible) {
      eligibleMatches += 1;
    }

    if (entry.expected.applied === entry.actual.applied) {
      appliedMatches += 1;
    }

    if (entry.expected.chosen === entry.actual.chosen) {
      chosenMatches += 1;
    }

    if (entry.expected.confidence === entry.actual.confidence) {
      confidenceMatches += 1;
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

      return left.id.localeCompare(right.id);
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
    eligibleMatches,
    appliedMatches,
    chosenMatches,
    confidenceMatches,
    eligibleAccuracy: eligibleMatches / denominator,
    appliedAccuracy: appliedMatches / denominator,
    chosenAccuracy: chosenMatches / denominator,
    confidenceAccuracy: confidenceMatches / denominator,
    passRate: passedCases / denominator,
    decisionCounts,
    confidenceCounts,
    topFailures: failures.slice(0, 5),
    cases
  };
}
