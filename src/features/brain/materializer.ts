import type { AiTranslationDraftFile } from "@/features/ai/types";
import { normalizeLookupText } from "@/features/ai/romanized-normalization";
import { buildSongTranslationMemoryPack } from "@/features/brain/memory-pack";
import {
  invalidateMemoryPackCachesByArtistKeys,
  listBrainClaimsByScope,
  readBrainNodeByTypeAndKey,
  updateBrainClaim,
  upsertBrainEdge,
  upsertBrainNode
} from "@/features/brain/repository";
import {
  buildBrainAliases,
  buildEdgeKey,
  normalizeBrainKey,
  splitArtistCredits,
  uniqStrings
} from "@/features/brain/normalize";
import { applyPolicyWeight, evaluateBrainNodePolicy, summarizePolicy } from "@/features/brain/policy";
import type { LafzBrainClaimRecord } from "@/features/brain/types";

type MaterializeAcceptedVocabularyClaimsOptions = {
  draftFile: AiTranslationDraftFile;
};

type MaterializeAcceptedVocabularyClaimsResult = {
  claimsMaterialized: number;
  nodeTouches: number;
  edgeTouches: number;
  invalidatedMemoryPacks: number;
  currentSongPackRefreshed: boolean;
  touchedArtistKeys: string[];
  sampleTerms: string[];
};

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function termUsedInSong(term: string, aliases: string[], lyricTexts: string[]) {
  const searchTerms = [term, ...aliases].map((value) => normalizeLookupText(value)).filter(Boolean);
  const haystack = lyricTexts.map((value) => normalizeLookupText(value)).filter(Boolean);
  return searchTerms.some((searchTerm) => haystack.some((line) => line.includes(searchTerm)));
}

function buildTermSenseKey(languageCode: string | null, term: string, meaning: string) {
  return [languageCode ?? "any", normalizeBrainKey(term) ?? term, normalizeBrainKey(meaning) ?? meaning].join("::");
}

function buildRenderingKey(meaning: string) {
  return normalizeBrainKey(meaning) ?? meaning.trim().toLowerCase();
}

function withPolicyMetadata(
  nodeType: Parameters<typeof evaluateBrainNodePolicy>[0],
  label: string,
  metadata?: Record<string, unknown>
) {
  const policy = evaluateBrainNodePolicy(nodeType, label);

  return {
    ...(metadata ?? {}),
    policy: summarizePolicy(policy)
  };
}

function isVocabularyClaim(claim: LafzBrainClaimRecord) {
  return claim.claimType === "song_vocabulary_observation" || claim.claimType === "artist_term_usage_observation";
}

function isAcceptedAndUnmaterialized(claim: LafzBrainClaimRecord) {
  if (!isVocabularyClaim(claim) || claim.status !== "accepted") {
    return false;
  }

  const materialization = isRecord(claim.payload.materialization) ? claim.payload.materialization : {};
  const materializedAt = asString(materialization.materializedAt);
  const claimUpdatedAt = claim.updatedAt ? new Date(claim.updatedAt).getTime() : 0;
  const materializedTime = materializedAt ? new Date(materializedAt).getTime() : 0;

  if (!materializedAt) {
    return true;
  }

  return !Number.isFinite(materializedTime) || materializedTime < claimUpdatedAt;
}

function getClaimArtistKeys(claim: LafzBrainClaimRecord, fallbackArtistKeys: string[]) {
  const explicitArtistKey = claim.scopeType === "artist" ? claim.scopeKey : asString(claim.payload.artistKey);

  if (explicitArtistKey) {
    return [explicitArtistKey];
  }

  return fallbackArtistKeys;
}

function getClaimAliases(claim: LafzBrainClaimRecord) {
  return Array.isArray(claim.payload.aliases)
    ? claim.payload.aliases.map((value) => asString(value)).filter((value): value is string => Boolean(value))
    : [];
}

function getClaimCategory(claim: LafzBrainClaimRecord) {
  return asString(claim.payload.category) ?? "entry";
}

export async function materializeAcceptedVocabularyClaims(
  options: MaterializeAcceptedVocabularyClaimsOptions
): Promise<MaterializeAcceptedVocabularyClaimsResult> {
  const fallbackArtistKeys = splitArtistCredits(options.draftFile.artist).map((entry) => entry.key);
  const [songClaims, artistClaims] = await Promise.all([
    listBrainClaimsByScope("song", [options.draftFile.spotifyTrackId], 200),
    fallbackArtistKeys.length > 0 ? listBrainClaimsByScope("artist", fallbackArtistKeys, 200) : Promise.resolve([])
  ]);
  const claims = [...songClaims, ...artistClaims].filter(isAcceptedAndUnmaterialized);

  if (claims.length === 0) {
    return {
      claimsMaterialized: 0,
      nodeTouches: 0,
      edgeTouches: 0,
      invalidatedMemoryPacks: 0,
      currentSongPackRefreshed: false,
      touchedArtistKeys: [],
      sampleTerms: []
    };
  }

  const lyricTexts = options.draftFile.lines.map((line) => line.original);
  const songNodeId = asString(claims.find((claim) => asString(claim.payload.songNodeId))?.payload.songNodeId);
  const touchedArtistKeys = new Set<string>();
  const sampleTerms = new Set<string>();
  let claimsMaterialized = 0;
  let nodeTouches = 0;
  let edgeTouches = 0;

  for (const claim of claims) {
    const term = asString(claim.payload.term);
    const meaning = asString(claim.payload.meaning);

    if (!term || !meaning) {
      continue;
    }

    const artistKeys = getClaimArtistKeys(claim, fallbackArtistKeys);
    const aliases = getClaimAliases(claim);
    const category = getClaimCategory(claim);
    const note = asString(claim.payload.note);
    const sourceLanguage = asString(claim.payload.sourceLanguage) ?? options.draftFile.sourceLanguage;
    const termKey = normalizeBrainKey(term);
    const meaningKey = normalizeBrainKey(meaning);

    if (!termKey || !meaningKey) {
      continue;
    }

    const termNode = await upsertBrainNode({
      nodeType: "term_surface",
      canonicalKey: termKey,
      displayLabel: term,
      aliases: buildBrainAliases([term, ...aliases]),
      languageCode: sourceLanguage,
      description: note ?? null,
      metadata: withPolicyMetadata("term_surface", term, {
        category,
        materializedFromClaimId: claim.id
      })
    });

    const senseNode = await upsertBrainNode({
      nodeType: "term_sense",
      canonicalKey: buildTermSenseKey(sourceLanguage, term, meaning),
      displayLabel: `${term} -> ${meaning}`,
      languageCode: sourceLanguage,
      description: note ?? meaning,
      metadata: withPolicyMetadata("term_sense", `${term} ${meaning}`, {
        term,
        meaning,
        note,
        materializedFromClaimId: claim.id
      })
    });

    const renderingNode = await upsertBrainNode({
      nodeType: "rendering",
      canonicalKey: buildRenderingKey(meaning),
      displayLabel: meaning,
      description: note ?? null,
      metadata: withPolicyMetadata("rendering", meaning, {
        materializedFromClaimId: claim.id
      })
    });

    if (!termNode || !senseNode || !renderingNode) {
      continue;
    }

    nodeTouches += 3;

    const baseWeight = claim.claimType === "artist_term_usage_observation" ? 0.88 : 0.8;

    await upsertBrainEdge({
      edgeKey: buildEdgeKey("term_surface_maps_to_term_sense", termNode.id, senseNode.id),
      edgeType: "term_surface_maps_to_term_sense",
      sourceNodeId: termNode.id,
      targetNodeId: senseNode.id,
      weight: baseWeight,
      metadata: {
        note,
        category,
        materializedFromClaimId: claim.id
      }
    });
    edgeTouches += 1;

    await upsertBrainEdge({
      edgeKey: buildEdgeKey("term_sense_prefers_rendering", senseNode.id, renderingNode.id),
      edgeType: "term_sense_prefers_rendering",
      sourceNodeId: senseNode.id,
      targetNodeId: renderingNode.id,
      weight: baseWeight + 0.06,
      metadata: {
        note,
        materializedFromClaimId: claim.id
      }
    });
    edgeTouches += 1;

    for (const artistKey of artistKeys) {
      const artistNode = await readBrainNodeByTypeAndKey("artist", artistKey);

      if (!artistNode) {
        continue;
      }

      touchedArtistKeys.add(artistKey);

      await upsertBrainEdge({
        edgeKey: buildEdgeKey("artist_uses_term_surface", artistNode.id, termNode.id),
        edgeType: "artist_uses_term_surface",
        sourceNodeId: artistNode.id,
        targetNodeId: termNode.id,
        weight: claim.claimType === "artist_term_usage_observation" ? 0.82 : 0.7,
        metadata: {
          category,
          materializedFromClaimId: claim.id
        }
      });
      edgeTouches += 1;

      await upsertBrainEdge({
        edgeKey: buildEdgeKey("artist_prefers_rendering", artistNode.id, renderingNode.id),
        edgeType: "artist_prefers_rendering",
        sourceNodeId: artistNode.id,
        targetNodeId: renderingNode.id,
        weight: category === "preferred_rendering" ? 0.88 : claim.claimType === "artist_term_usage_observation" ? 0.78 : 0.68,
        metadata: {
          term,
          note,
          materializedFromClaimId: claim.id
        }
      });
      edgeTouches += 1;
    }

    if (songNodeId && termUsedInSong(term, aliases, lyricTexts)) {
      await upsertBrainEdge({
        edgeKey: buildEdgeKey("song_uses_term_surface", songNodeId, termNode.id, songNodeId),
        edgeType: "song_uses_term_surface",
        sourceNodeId: songNodeId,
        targetNodeId: termNode.id,
        sourceSongId: songNodeId,
        weight: 0.86,
        metadata: {
          category,
          materializedFromClaimId: claim.id
        }
      });
      edgeTouches += 1;
    }

    await updateBrainClaim({
      claimId: claim.id,
      payloadMerge: {
        materialization: {
          status: "materialized",
          materializedAt: new Date().toISOString(),
          termNodeId: termNode.id,
          senseNodeId: senseNode.id,
          renderingNodeId: renderingNode.id,
          songNodeId: songNodeId ?? null,
          artistKeys,
          claimUpdatedAt: claim.updatedAt ?? null
        }
      }
    });

    claimsMaterialized += 1;
    if (sampleTerms.size < 8) {
      sampleTerms.add(term);
    }
  }

  const invalidatedMemoryPacks = await invalidateMemoryPackCachesByArtistKeys(Array.from(touchedArtistKeys));
  let currentSongPackRefreshed = false;

  if (claimsMaterialized > 0) {
    await buildSongTranslationMemoryPack({
      spotifyTrackId: options.draftFile.spotifyTrackId,
      artist: options.draftFile.artist,
      candidateTexts: options.draftFile.lines.slice(0, 24).map((line) => line.original),
      forceRefresh: true
    }).catch(() => null);
    currentSongPackRefreshed = true;
  }

  return {
    claimsMaterialized,
    nodeTouches,
    edgeTouches,
    invalidatedMemoryPacks,
    currentSongPackRefreshed,
    touchedArtistKeys: Array.from(touchedArtistKeys),
    sampleTerms: Array.from(sampleTerms)
  };
}
