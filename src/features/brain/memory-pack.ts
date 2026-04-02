import type { AiArtistMemory } from "@/features/ai/types";
import type { AiGlossaryEntry } from "@/features/ai/glossary";
import { requestOpenAiEmbeddings } from "@/features/ai/openai";
import { normalizeLookupText } from "@/features/ai/romanized-normalization";
import {
  buildBrainCandidateEmbeddingText,
  cosineSimilarity
} from "@/features/brain/embeddings";
import {
  listBrainEdgesBySourceNodeIds,
  listBrainNodesByTypeAndKeys,
  readBrainNodesByIds,
  readMemoryPackCache,
  readSongWorldModelByTrackId,
  readSongWorldModelsBySongNodeIds,
  writeMemoryPackCache
} from "@/features/brain/repository";
import {
  buildCandidateTextSignature,
  buildMemoryPackCacheKey,
  canonicalizeBrainMotif,
  isCanonicalBrainMotifNode,
  isReusableArtistEntityClass,
  normalizeBrainText,
  splitArtistCredits,
  tokenizeBrainText,
  uniqStrings
} from "@/features/brain/normalize";
import { evaluateBrainNodePolicy } from "@/features/brain/policy";
import type {
  LafzBrainConfidence,
  LafzBrainEdgeRecord,
  LafzBrainMemoryPack,
  LafzBrainMemoryPackAudit,
  LafzBrainMemoryPackCacheRecord,
  LafzBrainNodeRecord,
  LafzBrainRenderingHint,
  LafzBrainSymbolHint,
  LafzBrainTextHint
} from "@/features/brain/types";

const MEMORY_PACK_TTL_MS = 1000 * 60 * 15;
const MEMORY_PACK_RETRIEVAL_VERSION = 5;
const MAX_STYLE_HINTS = 8;
const MAX_MOTIF_HINTS = 10;
const MAX_RELATIONSHIP_PRIORS = 8;
const MAX_SYMBOL_HINTS = 8;
const MAX_RENDERING_HINTS = 16;
const MAX_WORLD_MODELS = 24;

type SongWorldModelSource = {
  spotifyTrackId: string;
  coreMotifs: string[];
  recurringSymbols: string[];
  relationshipsJson: unknown;
  updatedAt: string | null;
};

type HintAccumulator = {
  value: string;
  score: number;
  reasons: Set<string>;
  sourceSongIds: Set<string>;
  sourceNodeIds: Set<string>;
};

type SymbolAccumulator = HintAccumulator & {
  note?: string;
  frequency: number;
};

type RenderingAccumulator = {
  term: string;
  meaning: string;
  note?: string;
  source: "brain_rendering" | "brain_term";
  score: number;
  reasons: Set<string>;
  sourceSongIds: Set<string>;
  sourceNodeIds: Set<string>;
};

function clampScore(value: number) {
  return Math.max(0, Math.min(0.99, value));
}

function scoreToConfidence(score: number): LafzBrainConfidence {
  if (score >= 0.78) {
    return "high";
  }

  if (score >= 0.48) {
    return "medium";
  }

  return "low";
}

function buildAudit(candidateTextCount: number, candidateSignature: string | null = null): LafzBrainMemoryPackAudit {
  return {
    retrievalVersion: MEMORY_PACK_RETRIEVAL_VERSION,
    sourceSongIdsCount: 0,
    candidateTextCount,
    candidateSignature,
    filteredCounts: {
      style: 0,
      motif: 0,
      relationship: 0,
      symbol: 0,
      rendering: 0,
      semantic: 0
    },
    appliedRules: [
      "artist-specific ranking",
      "candidate-text overlap",
      "policy-based filtering",
      "recency weighting",
      "confidence calibration",
      "embedding-assisted semantic retrieval"
    ]
  };
}

function emptyPack(artistKeys: string[], candidateTextCount = 0, candidateSignature: string | null = null): LafzBrainMemoryPack {
  return {
    builtAt: new Date().toISOString(),
    artistKeys,
    sourceSongIds: [],
    styleHints: [],
    styleHintDetails: [],
    motifHints: [],
    motifHintDetails: [],
    relationshipPriors: [],
    relationshipPriorDetails: [],
    symbolHints: [],
    renderingHints: [],
    audit: buildAudit(candidateTextCount, candidateSignature)
  };
}

function recencyBoost(updatedAt: string | null | undefined) {
  if (!updatedAt) {
    return 0;
  }

  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays <= 14) {
    return 0.16;
  }

  if (ageDays <= 45) {
    return 0.11;
  }

  if (ageDays <= 120) {
    return 0.06;
  }

  return 0.02;
}

function lexicalOverlapBoost(value: string, candidateTokenSet: Set<string>) {
  if (candidateTokenSet.size === 0) {
    return 0;
  }

  const tokens = tokenizeBrainText(value);

  if (tokens.length === 0) {
    return 0;
  }

  const overlap = tokens.filter((token) => candidateTokenSet.has(token)).length;
  return Math.min(overlap / tokens.length, 1) * 0.24;
}

function semanticSimilarityBoost(node: LafzBrainNodeRecord | null | undefined, queryEmbedding: number[] | null | undefined) {
  if (!node?.embedding || !queryEmbedding) {
    return 0;
  }

  const similarity = cosineSimilarity(node.embedding, queryEmbedding);

  if (similarity < 0.28) {
    return 0;
  }

  return Math.min(Math.max(similarity - 0.28, 0), 0.32);
}

function toCandidateTokenSet(candidateTexts: string[]) {
  return new Set(candidateTexts.flatMap((value) => tokenizeBrainText(normalizeLookupText(value))));
}

function sortTextHints(hints: LafzBrainTextHint[]) {
  return [...hints].sort((left, right) => right.score - left.score || left.value.localeCompare(right.value));
}

function pushTextHint(
  target: Map<string, HintAccumulator>,
  value: string,
  score: number,
  reason: string,
  sourceSongId?: string | null,
  sourceNodeId?: string | null
) {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return;
  }

  const existing = target.get(normalizedValue) ?? {
    value: normalizedValue,
    score: 0,
    reasons: new Set<string>(),
    sourceSongIds: new Set<string>(),
    sourceNodeIds: new Set<string>()
  };

  existing.score = Math.max(existing.score, clampScore(score));
  existing.reasons.add(reason);

  if (sourceSongId) {
    existing.sourceSongIds.add(sourceSongId);
  }

  if (sourceNodeId) {
    existing.sourceNodeIds.add(sourceNodeId);
  }

  target.set(normalizedValue, existing);
}

function finalizeTextHints(entries: Map<string, HintAccumulator>, limit: number) {
  const all = Array.from(entries.values()).map<LafzBrainTextHint>((entry) => ({
    value: entry.value,
    score: Number(entry.score.toFixed(2)),
    confidence: scoreToConfidence(entry.score),
    reasons: Array.from(entry.reasons),
    sourceSongIds: Array.from(entry.sourceSongIds),
    sourceNodeIds: Array.from(entry.sourceNodeIds)
  }));

  return {
    all: sortTextHints(all),
    selected: sortTextHints(all).slice(0, limit)
  };
}

function pushSymbolHint(
  target: Map<string, SymbolAccumulator>,
  symbol: string,
  score: number,
  reason: string,
  sourceSongId?: string | null,
  sourceNodeId?: string | null,
  note?: string
) {
  const normalizedValue = symbol.trim();

  if (!normalizedValue) {
    return;
  }

  const existing = target.get(normalizedValue) ?? {
    value: normalizedValue,
    score: 0,
    reasons: new Set<string>(),
    sourceSongIds: new Set<string>(),
    sourceNodeIds: new Set<string>(),
    frequency: 0,
    ...(note ? { note } : {})
  };

  existing.score = Math.max(existing.score, clampScore(score));
  existing.frequency += 1;
  existing.reasons.add(reason);

  if (sourceSongId) {
    existing.sourceSongIds.add(sourceSongId);
  }

  if (sourceNodeId) {
    existing.sourceNodeIds.add(sourceNodeId);
  }

  if (note && !existing.note) {
    existing.note = note;
  }

  target.set(normalizedValue, existing);
}

function finalizeSymbolHints(entries: Map<string, SymbolAccumulator>, limit: number) {
  const all = Array.from(entries.values())
    .map<LafzBrainSymbolHint>((entry) => ({
      symbol: entry.value,
      frequency: entry.frequency,
      score: Number(entry.score.toFixed(2)),
      confidence: scoreToConfidence(entry.score),
      reasons: Array.from(entry.reasons),
      sourceSongIds: Array.from(entry.sourceSongIds),
      sourceNodeIds: Array.from(entry.sourceNodeIds),
      ...(entry.note ? { note: entry.note } : {})
    }))
    .sort((left, right) => right.score - left.score || right.frequency - left.frequency || left.symbol.localeCompare(right.symbol));

  return {
    all,
    selected: all.slice(0, limit)
  };
}

function pushRenderingHint(
  target: Map<string, RenderingAccumulator>,
  entry: LafzBrainRenderingHint
) {
  const key = `${normalizeBrainText(entry.term) ?? entry.term}::${normalizeBrainText(entry.meaning) ?? entry.meaning}`;
  const existing = target.get(key) ?? {
    term: entry.term,
    meaning: entry.meaning,
    note: entry.note,
    source: entry.source,
    score: 0,
    reasons: new Set<string>(),
    sourceSongIds: new Set<string>(),
    sourceNodeIds: new Set<string>()
  };

  existing.score = Math.max(existing.score, entry.score);
  existing.source = existing.source === "brain_rendering" ? existing.source : entry.source;

  for (const reason of entry.reasons) {
    existing.reasons.add(reason);
  }

  for (const sourceSongId of entry.sourceSongIds) {
    existing.sourceSongIds.add(sourceSongId);
  }

  for (const sourceNodeId of entry.sourceNodeIds) {
    existing.sourceNodeIds.add(sourceNodeId);
  }

  if (!existing.note && entry.note) {
    existing.note = entry.note;
  }

  target.set(key, existing);
}

function finalizeRenderingHints(entries: Map<string, RenderingAccumulator>, limit: number) {
  const all = Array.from(entries.values())
    .map<LafzBrainRenderingHint>((entry) => ({
      term: entry.term,
      meaning: entry.meaning,
      source: entry.source,
      score: Number(entry.score.toFixed(2)),
      confidence: scoreToConfidence(entry.score),
      reasons: Array.from(entry.reasons),
      sourceSongIds: Array.from(entry.sourceSongIds),
      sourceNodeIds: Array.from(entry.sourceNodeIds),
      ...(entry.note ? { note: entry.note } : {})
    }))
    .sort((left, right) => right.score - left.score || left.term.localeCompare(right.term) || left.meaning.localeCompare(right.meaning));

  return {
    all,
    selected: all.slice(0, limit)
  };
}

function parseRelationshipEntries(worldModel: SongWorldModelSource) {
  if (!Array.isArray(worldModel.relationshipsJson)) {
    return [] as Array<{ value: string; baseScore: number; reason: string; sourceSongId: string }>;
  }

  return worldModel.relationshipsJson.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [] as Array<{ value: string; baseScore: number; reason: string; sourceSongId: string }>;
    }

    const dynamic = typeof (entry as { dynamic?: unknown }).dynamic === "string"
      ? (entry as { dynamic: string }).dynamic.trim()
      : null;
    const powerBalance = typeof (entry as { powerBalance?: unknown }).powerBalance === "string"
      ? (entry as { powerBalance: string }).powerBalance.trim()
      : null;
    const confidence = typeof (entry as { confidence?: unknown }).confidence === "string"
      ? (entry as { confidence: string }).confidence
      : null;

    if (!dynamic) {
      return [] as Array<{ value: string; baseScore: number; reason: string; sourceSongId: string }>;
    }

    const value = powerBalance ? `${dynamic} (${powerBalance})` : dynamic;
    const baseScore = confidence === "high" ? 0.86 : confidence === "medium" ? 0.72 : 0.58;

    return [{
      value,
      baseScore,
      reason: "Observed in prior world-model relationship graph.",
      sourceSongId: worldModel.spotifyTrackId
    }];
  });
}

function buildArtistStyleHintDetails(artistNodes: LafzBrainNodeRecord[], personaStyleNodes: LafzBrainNodeRecord[]) {
  const hints = new Map<string, HintAccumulator>();

  for (const artistNode of artistNodes) {
    const metadata = artistNode.metadata;
    const personaSummary = typeof metadata.personaSummary === "string" ? metadata.personaSummary.trim() : null;
    const translationDirectives = Array.isArray(metadata.translationDirectives)
      ? metadata.translationDirectives.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const translationPreferences = Array.isArray(metadata.translationPreferences)
      ? metadata.translationPreferences.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const voiceNotes = Array.isArray(metadata.voiceNotes)
      ? metadata.voiceNotes.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];
    const stanceNotes = Array.isArray(metadata.stanceNotes)
      ? metadata.stanceNotes.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [];

    if (personaSummary) {
      pushTextHint(hints, personaSummary, 0.92, "Artist persona summary from canonical Lafz Brain memory.", undefined, artistNode.id);
    }

    for (const directive of translationDirectives) {
      pushTextHint(hints, directive, 0.9, "Artist translation directive from prior memory.", undefined, artistNode.id);
    }

    for (const preference of translationPreferences) {
      pushTextHint(hints, preference, 0.82, "Artist translation preference from prior memory.", undefined, artistNode.id);
    }

    for (const voiceNote of voiceNotes) {
      pushTextHint(hints, voiceNote, 0.76, "Artist voice note from prior memory.", undefined, artistNode.id);
    }

    for (const stanceNote of stanceNotes) {
      pushTextHint(hints, stanceNote, 0.76, "Artist stance note from prior memory.", undefined, artistNode.id);
    }
  }

  for (const personaNode of personaStyleNodes) {
    const policy = evaluateBrainNodePolicy("persona_style", personaNode.displayLabel);

    if (!policy.shouldInject) {
      continue;
    }

    pushTextHint(
      hints,
      personaNode.displayLabel,
      0.74 * policy.stability,
      policy.reasons[0] ?? "Artist persona style cluster.",
      undefined,
      personaNode.id
    );
  }

  return finalizeTextHints(hints, MAX_STYLE_HINTS);
}

function buildMotifHintDetails(
  worldModels: SongWorldModelSource[],
  artistMotifEdges: LafzBrainEdgeRecord[],
  motifNodeById: Map<string, LafzBrainNodeRecord>,
  candidateTokenSet: Set<string>,
  queryEmbedding: number[] | null
) {
  const hints = new Map<string, HintAccumulator>();
  let filteredOut = 0;

  for (const edge of artistMotifEdges) {
    const motifNode = motifNodeById.get(edge.targetNodeId);

    if (!motifNode) {
      filteredOut += 1;
      continue;
    }

    const isClaimBacked =
      typeof edge.metadata.materializedFromClaimId === "string" && edge.metadata.materializedFromClaimId.trim().length > 0;
    const isCanonicalFamily = isCanonicalBrainMotifNode(motifNode.displayLabel, motifNode.canonicalKey);

    if (!isClaimBacked && !isCanonicalFamily) {
      filteredOut += 1;
      continue;
    }

    const canonicalMotif = canonicalizeBrainMotif(motifNode.displayLabel);
    const motifLabel = canonicalMotif?.displayLabel ?? motifNode.displayLabel;
    const policy = evaluateBrainNodePolicy("motif", motifLabel);

    if (!policy.shouldInject) {
      filteredOut += 1;
      continue;
    }

    const score = clampScore(
      0.72 * policy.stability +
        Math.min(edge.weight, 1) * 0.08 +
        lexicalOverlapBoost(motifLabel, candidateTokenSet) +
        semanticSimilarityBoost(motifNode, queryEmbedding)
    );
    pushTextHint(
      hints,
      motifLabel,
      score,
      isClaimBacked ? "Artist-level recurring motif promoted from repeated Lafz Brain claims." : "Canonical artist motif from Lafz Brain.",
      undefined,
      motifNode.id
    );
  }

  for (const worldModel of worldModels) {
    for (const motif of worldModel.coreMotifs.map((value) => value.trim()).filter(Boolean)) {
      const canonicalMotif = canonicalizeBrainMotif(motif);

      if (!canonicalMotif) {
        continue;
      }

      const policy = evaluateBrainNodePolicy("motif", canonicalMotif.displayLabel);

      if (!policy.shouldInject) {
        filteredOut += 1;
        continue;
      }

      const score = clampScore(
        0.58 * policy.stability +
          recencyBoost(worldModel.updatedAt) +
          lexicalOverlapBoost(canonicalMotif.displayLabel, candidateTokenSet)
      );
      pushTextHint(
        hints,
        canonicalMotif.displayLabel,
        score,
        `Repeated motif recovered from prior song world models (${canonicalMotif.sourceLabel}).`,
        worldModel.spotifyTrackId
      );
    }
  }

  return {
    ...finalizeTextHints(hints, MAX_MOTIF_HINTS),
    filteredOut
  };
}

async function buildRelationshipHintDetails(
  worldModels: SongWorldModelSource[],
  artistNodes: LafzBrainNodeRecord[],
  candidateTokenSet: Set<string>
) {
  const hints = new Map<string, HintAccumulator>();

  const artistNodeIds = new Set(artistNodes.map((node) => node.id));
  const artistEntityEdges = await listBrainEdgesBySourceNodeIds(
    artistNodes.map((node) => node.id),
    ["artist_associates_entity_type"]
  );
  const sourceEntityTypeNodes = await readBrainNodesByIds(artistEntityEdges.map((edge) => edge.targetNodeId));
  const sourceEntityNodeById = new Map(sourceEntityTypeNodes.map((node) => [node.id, node] as const));
  const artistRelationshipEdges = (await listBrainEdgesBySourceNodeIds(
    sourceEntityTypeNodes.map((node) => node.id),
    ["entity_type_related_to_entity_type"]
  )).filter((edge) => edge.sourceSongId && artistNodeIds.has(edge.sourceSongId));
  const targetEntityTypeNodes = await readBrainNodesByIds(artistRelationshipEdges.map((edge) => edge.targetNodeId));
  const targetEntityNodeById = new Map(targetEntityTypeNodes.map((node) => [node.id, node] as const));

  for (const edge of artistRelationshipEdges) {
    const sourceNode = sourceEntityNodeById.get(edge.sourceNodeId);
    const targetNode = targetEntityNodeById.get(edge.targetNodeId);
    const sourceEntityClass =
      typeof sourceNode?.metadata.entityClass === "string" ? sourceNode.metadata.entityClass.trim() : null;
    const targetEntityClass =
      typeof targetNode?.metadata.entityClass === "string" ? targetNode.metadata.entityClass.trim() : null;
    const dynamic =
      typeof edge.metadata.dynamicFamilyLabel === "string"
        ? edge.metadata.dynamicFamilyLabel.trim()
        : typeof edge.metadata.dynamic === "string"
          ? edge.metadata.dynamic.trim()
          : null;
    const powerBalance = typeof edge.metadata.powerBalance === "string" ? edge.metadata.powerBalance.trim() : null;

    if (
      !sourceNode ||
      !targetNode ||
      !dynamic ||
      !isReusableArtistEntityClass(sourceEntityClass) ||
      !isReusableArtistEntityClass(targetEntityClass)
    ) {
      continue;
    }

    const value = powerBalance
      ? `${sourceNode.displayLabel} -> ${targetNode.displayLabel}: ${dynamic} (${powerBalance})`
      : `${sourceNode.displayLabel} -> ${targetNode.displayLabel}: ${dynamic}`;
    const score = clampScore(0.72 + lexicalOverlapBoost(value, candidateTokenSet) + Math.min(edge.weight, 1) * 0.16);
    pushTextHint(
      hints,
      value,
      score,
      "Artist-level entity relationship pattern from Lafz Brain.",
      undefined,
      sourceNode.id
    );
  }

  for (const worldModel of worldModels) {
    for (const relationship of parseRelationshipEntries(worldModel)) {
      pushTextHint(
        hints,
        relationship.value,
        clampScore(relationship.baseScore + recencyBoost(worldModel.updatedAt)),
        relationship.reason,
        relationship.sourceSongId
      );
    }
  }

  return finalizeTextHints(hints, MAX_RELATIONSHIP_PRIORS);
}

function buildSymbolHintDetails(worldModels: SongWorldModelSource[], candidateTokenSet: Set<string>) {
  const hints = new Map<string, SymbolAccumulator>();
  let filteredOut = 0;

  for (const worldModel of worldModels) {
    for (const symbol of worldModel.recurringSymbols.map((value) => value.trim()).filter(Boolean)) {
      const policy = evaluateBrainNodePolicy("symbol", symbol);

      if (!policy.shouldInject) {
        filteredOut += 1;
        continue;
      }

      const score = clampScore(0.56 * policy.stability + recencyBoost(worldModel.updatedAt) + lexicalOverlapBoost(symbol, candidateTokenSet));
      pushSymbolHint(
        hints,
        symbol,
        score,
        policy.reasons[0] ?? "Recurring symbol recovered from prior world models.",
        worldModel.spotifyTrackId
      );
    }
  }

  return {
    ...finalizeSymbolHints(hints, MAX_SYMBOL_HINTS),
    filteredOut
  };
}

function candidateTermMatches(node: LafzBrainNodeRecord, candidateTexts: string[]) {
  if (candidateTexts.length === 0) {
    return true;
  }

  const searchTerms = [node.displayLabel, ...node.aliases]
    .map((value) => normalizeLookupText(value))
    .filter(Boolean);

  return searchTerms.some((term) => candidateTexts.some((candidate) => candidate.includes(term)));
}

async function buildRenderingHintsFromGraph(
  artistNodes: LafzBrainNodeRecord[],
  candidateTexts: string[],
  queryEmbedding: number[] | null
) {
  const normalizedCandidateTexts = candidateTexts.map((value) => normalizeLookupText(value)).filter(Boolean);
  const candidateTokenSet = toCandidateTokenSet(candidateTexts);
  const artistEdges = await listBrainEdgesBySourceNodeIds(
    artistNodes.map((node) => node.id),
    ["artist_uses_term_surface", "artist_prefers_rendering"]
  );

  const directRenderingEdges = artistEdges.filter((edge) => edge.edgeType === "artist_prefers_rendering");
  const termEdges = artistEdges.filter((edge) => edge.edgeType === "artist_uses_term_surface");
  const renderingNodes = await readBrainNodesByIds(directRenderingEdges.map((edge) => edge.targetNodeId));
  const termNodes = (await readBrainNodesByIds(termEdges.map((edge) => edge.targetNodeId))).filter((node) =>
    candidateTermMatches(node, normalizedCandidateTexts)
  );
  const deduped = new Map<string, RenderingAccumulator>();

  for (const edge of directRenderingEdges) {
    const renderingNode = renderingNodes.find((node) => node.id === edge.targetNodeId);
    const term = typeof edge.metadata.term === "string" ? edge.metadata.term.trim() : null;

    if (!renderingNode || !term) {
      continue;
    }

    const matchBoost = lexicalOverlapBoost(term, candidateTokenSet);
    const semanticBoost = semanticSimilarityBoost(renderingNode, queryEmbedding);

    if (candidateTexts.length > 0 && matchBoost === 0 && semanticBoost < 0.05) {
      continue;
    }

    pushRenderingHint(deduped, {
      term,
      meaning: renderingNode.displayLabel,
      source: "brain_rendering",
      score: clampScore(0.7 + matchBoost + semanticBoost + Math.min(edge.weight, 1) * 0.15),
      confidence: "high",
      reasons: ["Artist-preferred rendering linked directly from Lafz Brain."],
      sourceSongIds: [],
      sourceNodeIds: [renderingNode.id],
      ...(typeof edge.metadata.note === "string" ? { note: edge.metadata.note } : {})
    });
  }

  const senseEdges = await listBrainEdgesBySourceNodeIds(
    termNodes.map((node) => node.id),
    ["term_surface_maps_to_term_sense"]
  );
  const senseNodes = await readBrainNodesByIds(senseEdges.map((edge) => edge.targetNodeId));
  const renderingEdges = await listBrainEdgesBySourceNodeIds(
    senseNodes.map((node) => node.id),
    ["term_sense_prefers_rendering"]
  );
  const senseRenderingNodes = await readBrainNodesByIds(renderingEdges.map((edge) => edge.targetNodeId));

  for (const edge of renderingEdges) {
    const senseEdge = senseEdges.find((candidate) => candidate.targetNodeId === edge.sourceNodeId);
    const termNode = senseEdge ? termNodes.find((candidate) => candidate.id === senseEdge.sourceNodeId) : null;
    const renderingNode = senseRenderingNodes.find((candidate) => candidate.id === edge.targetNodeId);

    if (!termNode || !renderingNode) {
      continue;
    }

    const matchBoost = lexicalOverlapBoost(termNode.displayLabel, candidateTokenSet);
    const semanticBoost = Math.max(
      semanticSimilarityBoost(termNode, queryEmbedding),
      semanticSimilarityBoost(renderingNode, queryEmbedding)
    );

    if (candidateTexts.length > 0 && matchBoost === 0 && semanticBoost < 0.05) {
      continue;
    }

    pushRenderingHint(deduped, {
      term: termNode.displayLabel,
      meaning: renderingNode.displayLabel,
      source: "brain_term",
      score: clampScore(0.58 + matchBoost + semanticBoost + Math.min(edge.weight, 1) * 0.12),
      confidence: "medium",
      reasons: ["Recovered from term-sense to rendering knowledge in Lafz Brain."],
      sourceSongIds: [],
      sourceNodeIds: [termNode.id, renderingNode.id],
      ...(typeof edge.metadata.note === "string" ? { note: edge.metadata.note } : {})
    });
  }

  return finalizeRenderingHints(deduped, MAX_RENDERING_HINTS);
}

export function hydrateBrainMemoryPack(
  payload: Partial<LafzBrainMemoryPack> | null | undefined,
  artistKeys: string[] = [],
  candidateTextCount = 0
): LafzBrainMemoryPack {
  const base = emptyPack(artistKeys, candidateTextCount, payload?.audit?.candidateSignature ?? null);

  if (!payload) {
    return base;
  }

  const sourceSongIds = uniqStrings(payload.sourceSongIds ?? []);
  const styleHintDetails = Array.isArray(payload.styleHintDetails)
    ? payload.styleHintDetails
    : (payload.styleHints ?? []).map((value) => ({
        value,
        score: 0.7,
        confidence: "medium" as const,
        reasons: ["Legacy cache entry."],
        sourceSongIds: [],
        sourceNodeIds: []
      }));
  const motifHintDetails = Array.isArray(payload.motifHintDetails)
    ? payload.motifHintDetails
    : (payload.motifHints ?? []).map((value) => ({
        value,
        score: 0.65,
        confidence: "medium" as const,
        reasons: ["Legacy cache entry."],
        sourceSongIds: [],
        sourceNodeIds: []
      }));
  const relationshipPriorDetails = Array.isArray(payload.relationshipPriorDetails)
    ? payload.relationshipPriorDetails
    : (payload.relationshipPriors ?? []).map((value) => ({
        value,
        score: 0.68,
        confidence: "medium" as const,
        reasons: ["Legacy cache entry."],
        sourceSongIds: [],
        sourceNodeIds: []
      }));
  const symbolHints = Array.isArray(payload.symbolHints)
    ? payload.symbolHints.map((entry) => ({
        ...entry,
        score: typeof entry.score === "number" ? entry.score : 0.6,
        confidence: entry.confidence ?? "medium",
        reasons: Array.isArray(entry.reasons) ? entry.reasons : ["Legacy cache entry."],
        sourceSongIds: Array.isArray(entry.sourceSongIds) ? entry.sourceSongIds : [],
        sourceNodeIds: Array.isArray(entry.sourceNodeIds) ? entry.sourceNodeIds : []
      }))
    : [];
  const renderingHints = Array.isArray(payload.renderingHints)
    ? payload.renderingHints.map((entry) => ({
        ...entry,
        score: typeof entry.score === "number" ? entry.score : 0.65,
        confidence: entry.confidence ?? "medium",
        reasons: Array.isArray(entry.reasons) ? entry.reasons : ["Legacy cache entry."],
        sourceSongIds: Array.isArray(entry.sourceSongIds) ? entry.sourceSongIds : [],
        sourceNodeIds: Array.isArray(entry.sourceNodeIds) ? entry.sourceNodeIds : []
      }))
    : [];

  return {
    builtAt: payload.builtAt ?? base.builtAt,
    artistKeys: payload.artistKeys ?? artistKeys,
    sourceSongIds,
    styleHints: payload.styleHints ?? styleHintDetails.map((entry) => entry.value),
    styleHintDetails,
    motifHints: payload.motifHints ?? motifHintDetails.map((entry) => entry.value),
    motifHintDetails,
    relationshipPriors: payload.relationshipPriors ?? relationshipPriorDetails.map((entry) => entry.value),
    relationshipPriorDetails,
    symbolHints,
    renderingHints,
    audit: {
      ...buildAudit(candidateTextCount),
      ...(payload.audit ?? {}),
      sourceSongIdsCount: sourceSongIds.length,
      candidateTextCount: payload.audit?.candidateTextCount ?? candidateTextCount,
      filteredCounts: {
        ...buildAudit(candidateTextCount).filteredCounts,
        ...(payload.audit?.filteredCounts ?? {})
      }
    }
  };
}

async function computeSongTranslationMemoryPack(options: {
  spotifyTrackId: string;
  artist: string | null;
  candidateTexts: string[];
}) {
  const artistCredits = splitArtistCredits(options.artist);
  const artistKeys = artistCredits.map((credit) => credit.key);
  const basePack = emptyPack(
    artistKeys,
    options.candidateTexts.length,
    buildCandidateTextSignature(options.candidateTexts)
  );
  const artistNodes = await listBrainNodesByTypeAndKeys("artist", artistKeys);

  if (artistNodes.length === 0) {
    return basePack;
  }

  const artistEdges = await listBrainEdgesBySourceNodeIds(
    artistNodes.map((node) => node.id),
    ["artist_has_persona_style", "artist_exhibits_motif", "artist_recorded_song", "artist_associates_entity_type"]
  );
  const personaStyleNodes = await readBrainNodesByIds(
    artistEdges.filter((edge) => edge.edgeType === "artist_has_persona_style").map((edge) => edge.targetNodeId)
  );
  const artistMotifEdges = artistEdges.filter((edge) => edge.edgeType === "artist_exhibits_motif");
  const motifNodes = await readBrainNodesByIds(artistMotifEdges.map((edge) => edge.targetNodeId));
  const motifNodeById = new Map(motifNodes.map((node) => [node.id, node] as const));
  const songNodeIds = uniqStrings(
    artistEdges.filter((edge) => edge.edgeType === "artist_recorded_song").map((edge) => edge.targetNodeId)
  );
  const currentSongWorldModel = await readSongWorldModelByTrackId(options.spotifyTrackId);
  const priorSongWorldModels = await readSongWorldModelsBySongNodeIds(songNodeIds, MAX_WORLD_MODELS);
  const worldModels: SongWorldModelSource[] = (
    currentSongWorldModel
      ? [currentSongWorldModel, ...priorSongWorldModels.filter((entry) => entry.spotifyTrackId !== currentSongWorldModel.spotifyTrackId)]
      : priorSongWorldModels
  ).map((entry) => ({
    spotifyTrackId: entry.spotifyTrackId,
    coreMotifs: entry.coreMotifs,
    recurringSymbols: entry.recurringSymbols,
    relationshipsJson: entry.relationshipsJson,
    updatedAt: entry.updatedAt
  }));
  const candidateTokenSet = toCandidateTokenSet(options.candidateTexts);
  const candidateSignature = buildCandidateTextSignature(options.candidateTexts);
  const candidateEmbeddingText = buildBrainCandidateEmbeddingText(options.candidateTexts);
  const candidateEmbedding =
    candidateEmbeddingText.length > 0
      ? await requestOpenAiEmbeddings([candidateEmbeddingText]).then((vectors) => vectors[0] ?? null).catch(() => null)
      : null;
  const style = buildArtistStyleHintDetails(artistNodes, personaStyleNodes);
  const motifs = buildMotifHintDetails(worldModels, artistMotifEdges, motifNodeById, candidateTokenSet, candidateEmbedding);
  const relationships = await buildRelationshipHintDetails(worldModels, artistNodes, candidateTokenSet);
  const symbols = buildSymbolHintDetails(worldModels, candidateTokenSet);
  const renderings = await buildRenderingHintsFromGraph(artistNodes, options.candidateTexts, candidateEmbedding);
  const sourceSongIds = uniqStrings(worldModels.map((entry) => entry.spotifyTrackId));

  return {
    builtAt: new Date().toISOString(),
    artistKeys,
    sourceSongIds,
    styleHints: style.selected.map((entry) => entry.value),
    styleHintDetails: style.selected,
    motifHints: motifs.selected.map((entry) => entry.value),
    motifHintDetails: motifs.selected,
    relationshipPriors: relationships.selected.map((entry) => entry.value),
    relationshipPriorDetails: relationships.selected,
    symbolHints: symbols.selected,
    renderingHints: renderings.selected,
    audit: {
      retrievalVersion: MEMORY_PACK_RETRIEVAL_VERSION,
      sourceSongIdsCount: sourceSongIds.length,
      candidateTextCount: options.candidateTexts.length,
      candidateSignature,
      filteredCounts: {
        style: Math.max(0, style.all.length - style.selected.length),
        motif: motifs.filteredOut + Math.max(0, motifs.all.length - motifs.selected.length),
        relationship: Math.max(0, relationships.all.length - relationships.selected.length),
        symbol: symbols.filteredOut + Math.max(0, symbols.all.length - symbols.selected.length),
        rendering: Math.max(0, renderings.all.length - renderings.selected.length),
        semantic: candidateEmbedding ? 0 : 0
      },
      appliedRules: [
        "artist-specific ranking",
        "candidate-text overlap",
        "policy-based filtering",
        "recency weighting",
        "confidence calibration",
        "embedding-assisted semantic retrieval"
      ]
    }
  } satisfies LafzBrainMemoryPack;
}

export async function buildSongTranslationMemoryPack(options: {
  spotifyTrackId: string;
  artist: string | null;
  candidateTexts: string[];
  forceRefresh?: boolean;
}) {
  const artistKeys = splitArtistCredits(options.artist).map((credit) => credit.key);
  const cacheKey = buildMemoryPackCacheKey(artistKeys, options.spotifyTrackId, options.candidateTexts);

  if (!options.forceRefresh) {
    const cached = await readMemoryPackCache(cacheKey);

    if (cached) {
      const ageMs = Date.now() - new Date(cached.updatedAt).getTime();

      if (cached.version === MEMORY_PACK_RETRIEVAL_VERSION && ageMs >= 0 && ageMs < MEMORY_PACK_TTL_MS) {
        return hydrateBrainMemoryPack(cached.payload, artistKeys, options.candidateTexts.length);
      }
    }
  }

  const pack = hydrateBrainMemoryPack(
    await computeSongTranslationMemoryPack(options),
    artistKeys,
    options.candidateTexts.length
  );
  const cacheRecord: LafzBrainMemoryPackCacheRecord = {
    cacheKey,
    payload: pack,
    updatedAt: new Date().toISOString(),
    version: MEMORY_PACK_RETRIEVAL_VERSION
  };

  await writeMemoryPackCache(cacheRecord);
  return pack;
}

function mergeCanonicalRenderings(
  artistMemory: AiArtistMemory["canonicalRenderings"] | undefined,
  renderingHints: LafzBrainRenderingHint[]
) {
  const existing = new Map<string, { term: string; rendering: string; note?: string }>();

  for (const entry of artistMemory ?? []) {
    existing.set(`${normalizeBrainText(entry.term) ?? entry.term}::${normalizeBrainText(entry.rendering) ?? entry.rendering}`, entry);
  }

  for (const hint of renderingHints) {
    const key = `${normalizeBrainText(hint.term) ?? hint.term}::${normalizeBrainText(hint.meaning) ?? hint.meaning}`;

    if (!existing.has(key)) {
      existing.set(key, {
        term: hint.term,
        rendering: hint.meaning,
        ...(hint.note ? { note: hint.note } : {})
      });
    }
  }

  return Array.from(existing.values()).slice(0, MAX_RENDERING_HINTS);
}

function mergePreferredRenderings(existing: AiGlossaryEntry[], renderingHints: LafzBrainRenderingHint[]) {
  const entries = new Map<string, AiGlossaryEntry>();

  for (const entry of existing) {
    entries.set(`${normalizeBrainText(entry.term) ?? entry.term}::${normalizeBrainText(entry.meaning) ?? entry.meaning}`, entry);
  }

  for (const hint of renderingHints) {
    const key = `${normalizeBrainText(hint.term) ?? hint.term}::${normalizeBrainText(hint.meaning) ?? hint.meaning}`;

    if (!entries.has(key)) {
      entries.set(key, {
        term: hint.term,
        meaning: hint.meaning,
        category: "preferred_rendering",
        ...(hint.note ? { note: hint.note } : {})
      });
    }
  }

  return Array.from(entries.values()).slice(0, MAX_RENDERING_HINTS + existing.length);
}

function buildPackSummaryNotes(pack: LafzBrainMemoryPack) {
  const notes: string[] = [];

  if (pack.relationshipPriors.length > 0) {
    notes.push(`Lafz Brain relationship priors: ${pack.relationshipPriors.join(", ")}`);
  }

  if (pack.symbolHints.length > 0) {
    notes.push(`Lafz Brain recurring symbols: ${pack.symbolHints.map((entry) => entry.symbol).join(", ")}`);
  }

  if (pack.sourceSongIds.length > 0) {
    notes.push(`Lafz Brain references ${pack.sourceSongIds.length} prior song model${pack.sourceSongIds.length === 1 ? "" : "s"}.`);
  }

  return notes;
}

export function hasBrainMemoryPackContent(pack: LafzBrainMemoryPack | null | undefined) {
  if (!pack) {
    return false;
  }

  return Boolean(
    pack.styleHints.length ||
      pack.motifHints.length ||
      pack.relationshipPriors.length ||
      pack.symbolHints.length ||
      pack.renderingHints.length
  );
}

export function mergeBrainMemoryIntoArtistContext(options: {
  artist: string | null;
  artistMemory: AiArtistMemory | null;
  preferredRenderings: AiGlossaryEntry[];
  pack: LafzBrainMemoryPack | null;
}) {
  if (!hasBrainMemoryPackContent(options.pack)) {
    return {
      artistMemory: options.artistMemory,
      preferredRenderings: options.preferredRenderings
    };
  }

  const artistKey = splitArtistCredits(options.artist)[0]?.key ?? "unknown";
  const displayName = splitArtistCredits(options.artist)[0]?.name ?? options.artist ?? artistKey;
  const pack = options.pack as LafzBrainMemoryPack;
  const baseMemory: AiArtistMemory =
    options.artistMemory ?? {
      artistKey,
      displayName,
      personaSummary: null,
      translationPreferences: [],
      translationDirectives: [],
      recurringThemes: [],
      recurringMotifs: [],
      relationshipPatterns: [],
      toneNotes: [],
      voiceNotes: [],
      stanceNotes: [],
      perspectiveNotes: [],
      notes: [],
      canonicalRenderings: [],
      glossaryEntries: []
    };

  const nextArtistMemory: AiArtistMemory = {
    ...baseMemory,
    translationPreferences: uniqStrings([...baseMemory.translationPreferences, ...pack.styleHints]),
    recurringMotifs: uniqStrings([...baseMemory.recurringMotifs, ...pack.motifHints]),
    relationshipPatterns: uniqStrings([...baseMemory.relationshipPatterns, ...pack.relationshipPriors]),
    notes: uniqStrings([...baseMemory.notes, ...buildPackSummaryNotes(pack)]),
    canonicalRenderings: mergeCanonicalRenderings(baseMemory.canonicalRenderings, pack.renderingHints)
  };

  return {
    artistMemory: nextArtistMemory,
    preferredRenderings: mergePreferredRenderings(options.preferredRenderings, pack.renderingHints)
  };
}
