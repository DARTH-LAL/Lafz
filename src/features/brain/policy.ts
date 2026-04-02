import type { LafzBrainKnowledgeScope, LafzBrainNodeType } from "@/features/brain/types";
import {
  isDirectiveLikePersonaStyleText,
  isGenericSingleTokenPersonaStyle,
  isSentenceLikePersonaStyleText,
  normalizeBrainKey,
  tokenizeBrainText
} from "@/features/brain/normalize";

type BrainPolicyDecision = {
  scope: LafzBrainKnowledgeScope;
  stability: number;
  shouldInject: boolean;
  reasons: string[];
};

const GENERIC_SYMBOL_KEYS = new Set([
  "eyes",
  "eye",
  "heart",
  "mind",
  "world",
  "dream",
  "dreams",
  "night",
  "nights",
  "pain",
  "tears",
  "smile"
]);

const GENERIC_MOTIF_KEYS = new Set([
  "love",
  "romance",
  "sadness",
  "emotion",
  "feelings",
  "beauty",
  "memory",
  "memories"
]);

const GENERIC_PERSONA_KEYS = new Set([
  "romantic",
  "emotional",
  "confident",
  "intense",
  "aggressive",
  "boastful",
  "threatening",
  "confrontational",
  "proud",
  "celebratory"
]);

function clampScore(value: number) {
  return Math.max(0.2, Math.min(1, value));
}

function isMultiToken(label: string) {
  return tokenizeBrainText(label).length > 1;
}

function classifyGenericConcept(nodeType: LafzBrainNodeType, label: string) {
  const key = normalizeBrainKey(label) ?? "";

  if (nodeType === "symbol") {
    return GENERIC_SYMBOL_KEYS.has(key);
  }

  if (nodeType === "motif") {
    return GENERIC_MOTIF_KEYS.has(key);
  }

  if (nodeType === "persona_style") {
    return GENERIC_PERSONA_KEYS.has(key);
  }

  return false;
}

export function evaluateBrainNodePolicy(nodeType: LafzBrainNodeType, label: string): BrainPolicyDecision {
  if (nodeType === "song" || nodeType === "entity_instance") {
    return {
      scope: "song_local",
      stability: 0.55,
      shouldInject: false,
      reasons: ["Song-specific memory should stay local to the current song context."]
    };
  }

  if (nodeType === "artist") {
    return {
      scope: "canonical",
      stability: 0.98,
      shouldInject: true,
      reasons: ["Artist identity is stable long-term knowledge."]
    };
  }

  if (nodeType === "term_surface" || nodeType === "term_sense" || nodeType === "rendering" || nodeType === "entity_type") {
    return {
      scope: "canonical",
      stability: 0.9,
      shouldInject: true,
      reasons: ["Lexical and type knowledge should remain durable across songs."]
    };
  }

  const isGeneric = classifyGenericConcept(nodeType, label);
  const multiToken = isMultiToken(label);

  if (nodeType === "persona_style" && isDirectiveLikePersonaStyleText(label)) {
    return {
      scope: "artist_local",
      stability: 0.35,
      shouldInject: false,
      reasons: ["Directive-like translation notes should not become reusable persona memory."]
    };
  }

  if (nodeType === "persona_style" && isGenericSingleTokenPersonaStyle(label)) {
    return {
      scope: "artist_local",
      stability: 0.42,
      shouldInject: false,
      reasons: ["Single-word mood labels are too broad to act as stable artist voice memory."]
    };
  }

  if (nodeType === "persona_style" && isSentenceLikePersonaStyleText(label)) {
    return {
      scope: "artist_local",
      stability: 0.46,
      shouldInject: false,
      reasons: ["Long sentence-style persona notes should be collapsed into canonical families before reuse."]
    };
  }

  if (nodeType === "symbol" || nodeType === "motif" || nodeType === "persona_style") {
    if (isGeneric) {
      return {
        scope: nodeType === "persona_style" ? "artist_local" : "song_local",
        stability: nodeType === "persona_style" ? 0.5 : 0.38,
        shouldInject: false,
        reasons: ["This concept is broad enough that it can add retrieval noise if promoted aggressively."]
      };
    }

    return {
      scope: nodeType === "persona_style" ? "artist_local" : "canonical",
      stability: multiToken ? 0.86 : 0.72,
      shouldInject: true,
      reasons: [
        multiToken
          ? "Multi-word concepts tend to stay more specific and retrieval-safe."
          : "Specific recurring concepts can help future translations."
      ]
    };
  }

  return {
    scope: "canonical",
    stability: 0.7,
    shouldInject: true,
    reasons: ["Default durable knowledge path."]
  };
}

export function applyPolicyWeight(baseWeight: number, decision: BrainPolicyDecision) {
  return clampScore(baseWeight * decision.stability);
}

export function summarizePolicy(decision: BrainPolicyDecision) {
  return {
    scope: decision.scope,
    stability: Number(decision.stability.toFixed(2)),
    shouldInject: decision.shouldInject,
    reasons: decision.reasons
  };
}

export function isInjectableBrainConcept(nodeType: LafzBrainNodeType, label: string) {
  return evaluateBrainNodePolicy(nodeType, label).shouldInject;
}
