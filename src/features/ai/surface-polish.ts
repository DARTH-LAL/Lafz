import type { AiTranslationConfidence, AiVerseState, AiWorldModelLine } from "./types.ts";

export type SurfacePolishSourceLine = {
  original: string;
};

export type SurfacePolishDraftLine = {
  chosen: string;
  confidence: AiTranslationConfidence;
  selectorReason: string | null;
  meaning: string;
  impliedMeaning?: string | null;
  register?: string | null;
};

export type SurfacePolishProposal = {
  apply: boolean;
  reason: string | null;
  safePolish: string;
  naturalPolish: string;
};

export type SurfacePolishAudit = {
  winner: "original" | "safe" | "natural";
  chosen: string;
  reason: string | null;
  fluencyGain: "none" | "minor" | "clear";
  semanticRisk: "low" | "medium" | "high";
};

export type SurfacePolishCandidateInput = {
  sourceLine: SurfacePolishSourceLine;
  draftLine: SurfacePolishDraftLine;
  proposal: SurfacePolishProposal;
  audit: SurfacePolishAudit;
  verseState?: Pick<AiVerseState, "summary" | "dominantIntents"> | null;
  lineWorldModel?: Pick<AiWorldModelLine, "referents" | "imagery"> | null;
};

export type SurfacePolishCandidateEvaluation = {
  eligible: boolean;
  applied: boolean;
  line: Pick<SurfacePolishDraftLine, "chosen" | "confidence" | "selectorReason">;
  reason: string | null;
  protectedAnchors: string[];
  originalAnchorScore: number;
  polishedAnchorScore: number;
};

const ADLIB_KEYS = new Set(["uh huh", "uh", "yeah", "woo", "whoa", "nah", "huh", "oh", "hey", "aujla", "mxrci"]);

function tokenizeEnglishHint(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizeEnglishChoiceKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function appendSurfacePolishReason(baseReason: string | null, polishReason: string | null) {
  const normalizedPolishReason = polishReason?.trim().replace(/[.]+$/g, "") ?? "improved English fluency without changing the meaning";

  if (!baseReason) {
    return `Surface polish: ${normalizedPolishReason}.`;
  }

  if (baseReason.toLowerCase().includes(normalizedPolishReason.toLowerCase())) {
    return baseReason;
  }

  return `${baseReason.replace(/\s+$/, "").replace(/[.]+$/g, ".")} Surface polish: ${normalizedPolishReason}.`;
}

function extractCapitalizedPhrases(value: string) {
  const matches = value.match(/\b[A-Z][A-Za-z0-9']*(?:\s+[A-Z][A-Za-z0-9']*){0,3}\b/g) ?? [];
  return matches.map((match) => match.trim()).filter(Boolean);
}

function isMeaningfulSourceLine(value: string) {
  const trimmed = value.trim();

  if (trimmed.length >= 10) {
    return true;
  }

  return tokenizeEnglishHint(trimmed).length >= 3;
}

function isAdlibLikeText(value: string) {
  const normalized = normalizeEnglishChoiceKey(value);

  if (!normalized) {
    return false;
  }

  if (ADLIB_KEYS.has(normalized)) {
    return true;
  }

  const tokens = normalized.split(" ").filter(Boolean);
  return tokens.length <= 2 && tokens.every((token) => ADLIB_KEYS.has(token) || token.length <= 3);
}

function extractProtectedAnchors(
  sourceLine: SurfacePolishSourceLine,
  draftLine: SurfacePolishDraftLine,
  lineWorldModel: Pick<AiWorldModelLine, "referents" | "imagery"> | null | undefined
) {
  const anchors = new Set<string>();
  const chosen = draftLine.chosen.trim();
  const normalizedChosen = normalizeEnglishChoiceKey(chosen);
  const normalizedOriginal = normalizeEnglishChoiceKey(sourceLine.original);

  if (normalizedOriginal && normalizedChosen.includes(normalizedOriginal) && sourceLine.original.trim().length >= 5) {
    anchors.add(sourceLine.original.trim());
  }

  for (const phrase of extractCapitalizedPhrases(chosen)) {
    if (phrase.length >= 3) {
      anchors.add(phrase);
    }
  }

  const specialTokens = chosen.match(/\b[A-Za-z0-9]*\d+[A-Za-z0-9-]*\b/g) ?? [];
  for (const token of specialTokens) {
    anchors.add(token.trim());
  }

  for (const referent of lineWorldModel?.referents ?? []) {
    const normalizedReferent = normalizeEnglishChoiceKey(referent);

    if (normalizedReferent && normalizedChosen.includes(normalizedReferent)) {
      anchors.add(referent);
    }
  }

  for (const imagery of lineWorldModel?.imagery ?? []) {
    const normalizedImagery = normalizeEnglishChoiceKey(imagery);

    if (normalizedImagery && normalizedChosen.includes(normalizedImagery)) {
      anchors.add(imagery);
    }
  }

  return Array.from(anchors).slice(0, 6);
}

function preservesProtectedAnchors(candidate: string, protectedAnchors: string[]) {
  const normalizedCandidate = normalizeEnglishChoiceKey(candidate);

  if (!normalizedCandidate) {
    return protectedAnchors.length === 0;
  }

  return protectedAnchors.every((anchor) => {
    const normalizedAnchor = normalizeEnglishChoiceKey(anchor);
    return !normalizedAnchor || normalizedCandidate.includes(normalizedAnchor);
  });
}

function isLikelyHookOrChant(sourceLine: SurfacePolishSourceLine, draftLine: SurfacePolishDraftLine) {
  const normalizedOriginal = normalizeEnglishChoiceKey(sourceLine.original);
  const normalizedChosen = normalizeEnglishChoiceKey(draftLine.chosen);
  const tokenCount = tokenizeEnglishHint(draftLine.chosen).length;

  if (!normalizedOriginal || !normalizedChosen) {
    return false;
  }

  return tokenCount <= 5 && normalizedChosen.includes(normalizedOriginal);
}

function isSurfacePolishEligible(sourceLine: SurfacePolishSourceLine, draftLine: SurfacePolishDraftLine) {
  if (draftLine.selectorReason === "Manually reviewed in Lafz.") {
    return false;
  }

  if (draftLine.confidence === "low") {
    return false;
  }

  if (!isMeaningfulSourceLine(sourceLine.original)) {
    return false;
  }

  if (isAdlibLikeText(draftLine.chosen)) {
    return false;
  }

  if (isLikelyHookOrChant(sourceLine, draftLine)) {
    return false;
  }

  return tokenizeEnglishHint(draftLine.chosen).length >= 5;
}

function scoreCandidateAgainstAnchor(
  candidate: string,
  line: Pick<SurfacePolishDraftLine, "meaning" | "impliedMeaning" | "register">,
  verseState: Pick<AiVerseState, "summary" | "dominantIntents"> | null | undefined
) {
  const candidateTokens = new Set(tokenizeEnglishHint(candidate));
  const anchorTokens = new Set(
    tokenizeEnglishHint(
      [line.meaning, line.impliedMeaning ?? "", line.register ?? "", verseState?.summary ?? "", ...(verseState?.dominantIntents ?? [])]
        .join(" ")
        .trim()
    )
  );

  if (candidateTokens.size === 0 || anchorTokens.size === 0) {
    return 0;
  }

  const shared = [...candidateTokens].filter((token) => anchorTokens.has(token)).length;
  return shared;
}

export function evaluateSurfacePolishCandidate(input: SurfacePolishCandidateInput): SurfacePolishCandidateEvaluation {
  const eligible = isSurfacePolishEligible(input.sourceLine, input.draftLine);
  const protectedAnchors = extractProtectedAnchors(input.sourceLine, input.draftLine, input.lineWorldModel);
  const originalAnchorScore = scoreCandidateAgainstAnchor(input.draftLine.chosen, input.draftLine, input.verseState);

  if (!eligible) {
    return {
      eligible: false,
      applied: false,
      line: {
        chosen: input.draftLine.chosen,
        confidence: input.draftLine.confidence,
        selectorReason: input.draftLine.selectorReason
      },
      reason: "Surface polish skipped because the line was not eligible.",
      protectedAnchors,
      originalAnchorScore,
      polishedAnchorScore: originalAnchorScore
    };
  }

  if (!input.proposal.apply) {
    return {
      eligible: true,
      applied: false,
      line: {
        chosen: input.draftLine.chosen,
        confidence: input.draftLine.confidence,
        selectorReason: input.draftLine.selectorReason
      },
      reason: "Surface polish skipped because the provider declined to apply polish.",
      protectedAnchors,
      originalAnchorScore,
      polishedAnchorScore: originalAnchorScore
    };
  }

  if (input.audit.winner === "original" || input.audit.fluencyGain === "none") {
    return {
      eligible: true,
      applied: false,
      line: {
        chosen: input.draftLine.chosen,
        confidence: input.draftLine.confidence,
        selectorReason: input.draftLine.selectorReason
      },
      reason:
        input.audit.winner === "original"
          ? "Surface polish skipped because the audit kept the original line."
          : "Surface polish skipped because the audit found no fluency gain.",
      protectedAnchors,
      originalAnchorScore,
      polishedAnchorScore: originalAnchorScore
    };
  }

  const candidateText =
    input.audit.winner === "safe"
      ? input.proposal.safePolish
      : input.audit.winner === "natural"
        ? input.proposal.naturalPolish
        : input.draftLine.chosen;

  if (!candidateText || normalizeEnglishChoiceKey(candidateText) === normalizeEnglishChoiceKey(input.draftLine.chosen)) {
    return {
      eligible: true,
      applied: false,
      line: {
        chosen: input.draftLine.chosen,
        confidence: input.draftLine.confidence,
        selectorReason: input.draftLine.selectorReason
      },
      reason: "Surface polish skipped because the polished text matched the original line.",
      protectedAnchors,
      originalAnchorScore,
      polishedAnchorScore: originalAnchorScore
    };
  }

  if (!preservesProtectedAnchors(candidateText, protectedAnchors)) {
    return {
      eligible: true,
      applied: false,
      line: {
        chosen: input.draftLine.chosen,
        confidence: input.draftLine.confidence,
        selectorReason: input.draftLine.selectorReason
      },
      reason: "Surface polish skipped because the candidate dropped a protected anchor.",
      protectedAnchors,
      originalAnchorScore,
      polishedAnchorScore: scoreCandidateAgainstAnchor(candidateText, input.draftLine, input.verseState)
    };
  }

  if (input.audit.semanticRisk === "high" || (input.audit.semanticRisk === "medium" && input.audit.winner === "natural")) {
    return {
      eligible: true,
      applied: false,
      line: {
        chosen: input.draftLine.chosen,
        confidence: input.draftLine.confidence,
        selectorReason: input.draftLine.selectorReason
      },
      reason: "Surface polish skipped because the audit flagged semantic risk.",
      protectedAnchors,
      originalAnchorScore,
      polishedAnchorScore: scoreCandidateAgainstAnchor(candidateText, input.draftLine, input.verseState)
    };
  }

  const polishedAnchorScore = scoreCandidateAgainstAnchor(candidateText, input.draftLine, input.verseState);
  if (polishedAnchorScore + 1 < originalAnchorScore) {
    return {
      eligible: true,
      applied: false,
      line: {
        chosen: input.draftLine.chosen,
        confidence: input.draftLine.confidence,
        selectorReason: input.draftLine.selectorReason
      },
      reason: "Surface polish skipped because the candidate lost too much anchor overlap.",
      protectedAnchors,
      originalAnchorScore,
      polishedAnchorScore
    };
  }

  return {
    eligible: true,
    applied: true,
    line: {
      chosen: candidateText,
      confidence:
        input.audit.semanticRisk === "medium" && input.draftLine.confidence === "high"
          ? "medium"
          : input.draftLine.confidence,
      selectorReason: appendSurfacePolishReason(input.draftLine.selectorReason, input.audit.reason ?? input.proposal.reason)
    },
    reason: null,
    protectedAnchors,
    originalAnchorScore,
    polishedAnchorScore
  };
}
