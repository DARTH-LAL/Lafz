import type { LafzBrainNodeRecord } from "@/features/brain/types";
import { normalizeBrainText, uniqStrings } from "@/features/brain/normalize";

export function buildBrainNodeEmbeddingText(node: Pick<LafzBrainNodeRecord, "nodeType" | "displayLabel" | "aliases" | "description" | "metadata">) {
  const parts = [
    `type:${node.nodeType}`,
    node.displayLabel,
    ...(node.aliases ?? []),
    node.description ?? null
  ];

  if (node.nodeType === "term_sense") {
    parts.push(typeof node.metadata.term === "string" ? node.metadata.term : null);
    parts.push(typeof node.metadata.meaning === "string" ? node.metadata.meaning : null);
  }

  if (node.nodeType === "artist") {
    const personaSummary = typeof node.metadata.personaSummary === "string" ? node.metadata.personaSummary : null;
    parts.push(personaSummary);
  }

  return uniqStrings(parts.map((value) => normalizeBrainText(value))).join(" | ");
}

export function buildBrainCandidateEmbeddingText(candidateTexts: string[]) {
  return uniqStrings(candidateTexts.map((value) => normalizeBrainText(value))).slice(0, 24).join(" || ");
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}
