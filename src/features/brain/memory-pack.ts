import type { AiArtistMemory } from "@/features/ai/types";
import type { AiGlossaryEntry } from "@/features/ai/glossary";
import { normalizeLookupText } from "@/features/ai/romanized-normalization";
import {
  listBrainEdgesBySourceNodeIds,
  listBrainNodesByTypeAndKeys,
  readBrainNodesByIds,
  readMemoryPackCache,
  readSongWorldModelByTrackId,
  readSongWorldModelsBySongNodeIds,
  writeMemoryPackCache
} from "@/features/brain/repository";
import { buildMemoryPackCacheKey, normalizeBrainText, splitArtistCredits, uniqStrings } from "@/features/brain/normalize";
import type { LafzBrainMemoryPack, LafzBrainMemoryPackCacheRecord, LafzBrainNodeRecord, LafzBrainRenderingHint } from "@/features/brain/types";

const MEMORY_PACK_TTL_MS = 1000 * 60 * 15;
const MAX_STYLE_HINTS = 8;
const MAX_MOTIF_HINTS = 10;
const MAX_RELATIONSHIP_PRIORS = 8;
const MAX_SYMBOL_HINTS = 8;
const MAX_RENDERING_HINTS = 16;
const MAX_WORLD_MODELS = 24;

function emptyPack(artistKeys: string[]): LafzBrainMemoryPack {
  return {
    builtAt: new Date().toISOString(),
    artistKeys,
    sourceSongIds: [],
    styleHints: [],
    motifHints: [],
    relationshipPriors: [],
    symbolHints: [],
    renderingHints: []
  };
}

function countBy(values: string[]) {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
}

function sortByCountDesc(counts: Map<string, number>) {
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value, count]) => ({ value, count }));
}

function parseRelationshipPriors(relationshipsJson: unknown) {
  if (!Array.isArray(relationshipsJson)) {
    return [] as string[];
  }

  return relationshipsJson
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const dynamic = typeof (entry as { dynamic?: unknown }).dynamic === "string"
        ? (entry as { dynamic: string }).dynamic.trim()
        : null;
      const powerBalance = typeof (entry as { powerBalance?: unknown }).powerBalance === "string"
        ? (entry as { powerBalance: string }).powerBalance.trim()
        : null;

      if (!dynamic) {
        return null;
      }

      return powerBalance ? `${dynamic} (${powerBalance})` : dynamic;
    })
    .filter((value): value is string => Boolean(value));
}

function buildArtistStyleHints(artistNodes: LafzBrainNodeRecord[]) {
  const hints: string[] = [];

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
      hints.push(personaSummary);
    }

    hints.push(...translationDirectives, ...translationPreferences, ...voiceNotes, ...stanceNotes);
  }

  return uniqStrings(hints).slice(0, MAX_STYLE_HINTS);
}

function buildSymbolHints(worldModels: Array<{ recurringSymbols: string[] }>) {
  const counts = countBy(worldModels.flatMap((worldModel) => worldModel.recurringSymbols.map((value) => value.trim()).filter(Boolean)));
  return sortByCountDesc(counts)
    .slice(0, MAX_SYMBOL_HINTS)
    .map(({ value, count }) => ({ symbol: value, frequency: count }));
}

function buildMotifHints(worldModels: Array<{ coreMotifs: string[] }>, artistMotifNodes: LafzBrainNodeRecord[]) {
  const counts = countBy([
    ...artistMotifNodes.map((node) => node.displayLabel),
    ...worldModels.flatMap((worldModel) => worldModel.coreMotifs.map((value) => value.trim()).filter(Boolean))
  ]);

  return sortByCountDesc(counts)
    .slice(0, MAX_MOTIF_HINTS)
    .map(({ value }) => value);
}

function buildRelationshipHints(worldModels: Array<{ relationshipsJson: unknown }>) {
  const counts = countBy(worldModels.flatMap((worldModel) => parseRelationshipPriors(worldModel.relationshipsJson)));
  return sortByCountDesc(counts)
    .slice(0, MAX_RELATIONSHIP_PRIORS)
    .map(({ value }) => value);
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

function dedupeRenderingHints(entries: LafzBrainRenderingHint[]) {
  const deduped = new Map<string, LafzBrainRenderingHint>();

  for (const entry of entries) {
    const key = `${normalizeBrainText(entry.term) ?? entry.term}::${normalizeBrainText(entry.meaning) ?? entry.meaning}`;

    if (!deduped.has(key)) {
      deduped.set(key, entry);
    }
  }

  return Array.from(deduped.values()).slice(0, MAX_RENDERING_HINTS);
}

async function buildRenderingHintsFromGraph(artistNodes: LafzBrainNodeRecord[], candidateTexts: string[]) {
  const normalizedCandidateTexts = candidateTexts.map((value) => normalizeLookupText(value)).filter(Boolean);
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

  const directHints = directRenderingEdges
    .flatMap((edge): LafzBrainRenderingHint[] => {
      const renderingNode = renderingNodes.find((node) => node.id === edge.targetNodeId);
      const term = typeof edge.metadata.term === "string" ? edge.metadata.term.trim() : null;

      if (!renderingNode || !term) {
        return [];
      }

      return [{
        term,
        meaning: renderingNode.displayLabel,
        note: typeof edge.metadata.note === "string" ? edge.metadata.note : undefined,
        source: "brain_rendering"
      }];
    });

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

  const termHints = renderingEdges
    .flatMap((edge): LafzBrainRenderingHint[] => {
      const senseEdge = senseEdges.find((candidate) => candidate.targetNodeId === edge.sourceNodeId);
      const termNode = senseEdge ? termNodes.find((candidate) => candidate.id === senseEdge.sourceNodeId) : null;
      const renderingNode = senseRenderingNodes.find((candidate) => candidate.id === edge.targetNodeId);

      if (!termNode || !renderingNode) {
        return [];
      }

      return [{
        term: termNode.displayLabel,
        meaning: renderingNode.displayLabel,
        note: typeof edge.metadata.note === "string" ? edge.metadata.note : undefined,
        source: "brain_term"
      }];
    });

  return dedupeRenderingHints([...directHints, ...termHints]);
}

async function computeSongTranslationMemoryPack(options: {
  spotifyTrackId: string;
  artist: string | null;
  candidateTexts: string[];
}) {
  const artistCredits = splitArtistCredits(options.artist);
  const artistKeys = artistCredits.map((credit) => credit.key);
  const basePack = emptyPack(artistKeys);
  const artistNodes = await listBrainNodesByTypeAndKeys("artist", artistKeys);

  if (artistNodes.length === 0) {
    return basePack;
  }

  const artistEdges = await listBrainEdgesBySourceNodeIds(
    artistNodes.map((node) => node.id),
    ["artist_has_persona_style", "artist_exhibits_motif", "artist_recorded_song"]
  );
  const personaStyleNodes = await readBrainNodesByIds(
    artistEdges.filter((edge) => edge.edgeType === "artist_has_persona_style").map((edge) => edge.targetNodeId)
  );
  const motifNodes = await readBrainNodesByIds(
    artistEdges.filter((edge) => edge.edgeType === "artist_exhibits_motif").map((edge) => edge.targetNodeId)
  );
  const songNodeIds = uniqStrings(
    artistEdges.filter((edge) => edge.edgeType === "artist_recorded_song").map((edge) => edge.targetNodeId)
  );
  const currentSongWorldModel = await readSongWorldModelByTrackId(options.spotifyTrackId);
  const priorSongWorldModels = await readSongWorldModelsBySongNodeIds(songNodeIds, MAX_WORLD_MODELS);
  const worldModels = currentSongWorldModel
    ? [currentSongWorldModel, ...priorSongWorldModels.filter((entry) => entry.spotifyTrackId !== currentSongWorldModel.spotifyTrackId)]
    : priorSongWorldModels;
  const renderingHints = await buildRenderingHintsFromGraph(artistNodes, options.candidateTexts);

  const pack: LafzBrainMemoryPack = {
    builtAt: new Date().toISOString(),
    artistKeys,
    sourceSongIds: uniqStrings(worldModels.map((entry) => entry.spotifyTrackId)),
    styleHints: uniqStrings([
      ...buildArtistStyleHints(artistNodes),
      ...personaStyleNodes.map((node) => node.displayLabel)
    ]).slice(0, MAX_STYLE_HINTS),
    motifHints: buildMotifHints(worldModels, motifNodes),
    relationshipPriors: buildRelationshipHints(worldModels),
    symbolHints: buildSymbolHints(worldModels),
    renderingHints
  };

  return pack;
}

export async function buildSongTranslationMemoryPack(options: {
  spotifyTrackId: string;
  artist: string | null;
  candidateTexts: string[];
  forceRefresh?: boolean;
}) {
  const artistKeys = splitArtistCredits(options.artist).map((credit) => credit.key);
  const cacheKey = buildMemoryPackCacheKey(artistKeys, options.spotifyTrackId);

  if (!options.forceRefresh) {
    const cached = await readMemoryPackCache(cacheKey);

    if (cached) {
      const ageMs = Date.now() - new Date(cached.updatedAt).getTime();

      if (ageMs >= 0 && ageMs < MEMORY_PACK_TTL_MS) {
        return cached.payload;
      }
    }
  }

  const pack = await computeSongTranslationMemoryPack(options);
  const cacheRecord: LafzBrainMemoryPackCacheRecord = {
    cacheKey,
    payload: pack,
    updatedAt: new Date().toISOString()
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
