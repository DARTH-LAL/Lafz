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
  canonicalizeBrainMotif,
  canonicalizePersonaStyle,
  canonicalizeRelationshipDynamic,
  classifyBrainEntity,
  isReusableArtistEntityClass,
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

type MaterializeAcceptedEntityClaimsResult = {
  claimsMaterialized: number;
  nodeTouches: number;
  edgeTouches: number;
  invalidatedMemoryPacks: number;
  currentSongPackRefreshed: boolean;
  touchedArtistKeys: string[];
  samplePatterns: string[];
};

type MaterializeAcceptedMotifClaimsResult = {
  claimsMaterialized: number;
  nodeTouches: number;
  edgeTouches: number;
  invalidatedMemoryPacks: number;
  currentSongPackRefreshed: boolean;
  touchedArtistKeys: string[];
  sampleMotifs: string[];
};

type MaterializeAcceptedPersonaClaimsResult = {
  claimsMaterialized: number;
  nodeTouches: number;
  edgeTouches: number;
  invalidatedMemoryPacks: number;
  currentSongPackRefreshed: boolean;
  touchedArtistKeys: string[];
  sampleStyles: string[];
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

function isEntityClaim(claim: LafzBrainClaimRecord) {
  return claim.claimType === "artist_entity_role_observation" || claim.claimType === "artist_relationship_pattern_observation";
}

function isMotifClaim(claim: LafzBrainClaimRecord) {
  return claim.claimType === "artist_motif_pattern_observation";
}

function isPersonaClaim(claim: LafzBrainClaimRecord) {
  return claim.claimType === "artist_persona_style_observation";
}

function isAcceptedAndUnmaterialized(claim: LafzBrainClaimRecord) {
  if ((!isVocabularyClaim(claim) && !isEntityClaim(claim) && !isMotifClaim(claim) && !isPersonaClaim(claim)) || claim.status !== "accepted") {
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

function getClaimEntityRole(claim: LafzBrainClaimRecord) {
  return asString(claim.payload.entityRole) ?? null;
}

function getClaimSourceRole(claim: LafzBrainClaimRecord) {
  return asString(claim.payload.sourceRole) ?? null;
}

function getClaimTargetRole(claim: LafzBrainClaimRecord) {
  return asString(claim.payload.targetRole) ?? null;
}

function getClaimDynamic(claim: LafzBrainClaimRecord) {
  return asString(claim.payload.dynamic) ?? null;
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

export async function materializeAcceptedEntityClaims(
  options: MaterializeAcceptedVocabularyClaimsOptions
): Promise<MaterializeAcceptedEntityClaimsResult> {
  const fallbackArtistKeys = splitArtistCredits(options.draftFile.artist).map((entry) => entry.key);
  const artistClaims = fallbackArtistKeys.length > 0 ? await listBrainClaimsByScope("artist", fallbackArtistKeys, 300) : [];
  const claims = artistClaims.filter((claim) => isEntityClaim(claim) && isAcceptedAndUnmaterialized(claim));

  if (claims.length === 0) {
    return {
      claimsMaterialized: 0,
      nodeTouches: 0,
      edgeTouches: 0,
      invalidatedMemoryPacks: 0,
      currentSongPackRefreshed: false,
      touchedArtistKeys: [],
      samplePatterns: []
    };
  }

  const touchedArtistKeys = new Set<string>();
  const samplePatterns = new Set<string>();
  let claimsMaterialized = 0;
  let nodeTouches = 0;
  let edgeTouches = 0;

  for (const claim of claims) {
    const artistKeys = getClaimArtistKeys(claim, fallbackArtistKeys);

    if (claim.claimType === "artist_entity_role_observation") {
      const entityRole = getClaimEntityRole(claim);
      const entityKey = asString(claim.payload.entityKey);
      const entityClass = classifyBrainEntity(entityKey, asString(claim.payload.entityLabel), asString(claim.payload.description));
      const roleKey = normalizeBrainKey(entityKey) ?? normalizeBrainKey(entityRole);

      if (!entityRole || !roleKey) {
        continue;
      }

      if (!isReusableArtistEntityClass(entityClass)) {
        await updateBrainClaim({
          claimId: claim.id,
          payloadMerge: {
            materialization: {
              status: "skipped_non_reusable_entity",
              materializedAt: new Date().toISOString(),
              artistKeys,
              claimUpdatedAt: claim.updatedAt ?? null
            }
          }
        });
        continue;
      }

      const entityTypeNode = await upsertBrainNode({
        nodeType: "entity_type",
        canonicalKey: roleKey,
        displayLabel: entityRole,
        description: asString(claim.payload.description),
        metadata: withPolicyMetadata("entity_type", entityRole, {
          materializedFromClaimId: claim.id,
          entityKey,
          entityClass,
          entityLabel: asString(claim.payload.entityLabel),
          salience: asString(claim.payload.salience)
        })
      });

      if (!entityTypeNode) {
        continue;
      }

      nodeTouches += 1;

      for (const artistKey of artistKeys) {
        const artistNode = await readBrainNodeByTypeAndKey("artist", artistKey);

        if (!artistNode) {
          continue;
        }

        touchedArtistKeys.add(artistKey);

        await upsertBrainEdge({
          edgeKey: buildEdgeKey("artist_associates_entity_type", artistNode.id, entityTypeNode.id),
          edgeType: "artist_associates_entity_type",
          sourceNodeId: artistNode.id,
          targetNodeId: entityTypeNode.id,
          weight: claim.confidenceScore,
          metadata: {
            materializedFromClaimId: claim.id,
            salience: asString(claim.payload.salience),
            entityLabel: asString(claim.payload.entityLabel)
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
            entityTypeNodeId: entityTypeNode.id,
            artistKeys,
            claimUpdatedAt: claim.updatedAt ?? null
          }
        }
      });

      claimsMaterialized += 1;
      if (samplePatterns.size < 8) {
        samplePatterns.add(entityRole);
      }

      continue;
    }

    if (claim.claimType !== "artist_relationship_pattern_observation") {
      continue;
    }

    const sourceRole = getClaimSourceRole(claim);
    const targetRole = getClaimTargetRole(claim);
    const dynamic = getClaimDynamic(claim);
    const sourceEntityKey = asString(claim.payload.sourceEntityKey);
    const targetEntityKey = asString(claim.payload.targetEntityKey);
    const sourceEntityClass = classifyBrainEntity(sourceEntityKey, sourceRole, null);
    const targetEntityClass = classifyBrainEntity(targetEntityKey, targetRole, null);
    const sourceRoleKey = normalizeBrainKey(sourceEntityKey) ?? normalizeBrainKey(sourceRole);
    const targetRoleKey = normalizeBrainKey(targetEntityKey) ?? normalizeBrainKey(targetRole);
    const dynamicFamily =
      canonicalizeRelationshipDynamic(dynamic, sourceEntityKey ?? sourceRole, targetEntityKey ?? targetRole) ??
      (asString(claim.payload.dynamicFamilyKey) && asString(claim.payload.dynamicFamilyLabel)
        ? {
            canonicalKey: asString(claim.payload.dynamicFamilyKey) as string,
            displayLabel: asString(claim.payload.dynamicFamilyLabel) as string,
            sourceLabel: dynamic ?? asString(claim.payload.dynamicFamilyLabel) ?? ""
          }
        : null);

    if (!sourceRole || !targetRole || !dynamic || !sourceRoleKey || !targetRoleKey) {
      continue;
    }

    if (!isReusableArtistEntityClass(sourceEntityClass) || !isReusableArtistEntityClass(targetEntityClass)) {
      await updateBrainClaim({
        claimId: claim.id,
        payloadMerge: {
          materialization: {
            status: "skipped_non_reusable_pattern",
            materializedAt: new Date().toISOString(),
            artistKeys,
            claimUpdatedAt: claim.updatedAt ?? null
          }
        }
      });
      continue;
    }

    const [sourceEntityTypeNode, targetEntityTypeNode] = await Promise.all([
      upsertBrainNode({
        nodeType: "entity_type",
        canonicalKey: sourceRoleKey,
        displayLabel: sourceRole,
        metadata: withPolicyMetadata("entity_type", sourceRole, {
          materializedFromClaimId: claim.id,
          entityKey: sourceEntityKey,
          entityClass: sourceEntityClass
        })
      }),
      upsertBrainNode({
        nodeType: "entity_type",
        canonicalKey: targetRoleKey,
        displayLabel: targetRole,
        metadata: withPolicyMetadata("entity_type", targetRole, {
          materializedFromClaimId: claim.id,
          entityKey: targetEntityKey,
          entityClass: targetEntityClass
        })
      })
    ]);

    if (!sourceEntityTypeNode || !targetEntityTypeNode) {
      continue;
    }

    nodeTouches += 2;

    for (const artistKey of artistKeys) {
      const artistNode = await readBrainNodeByTypeAndKey("artist", artistKey);

      if (!artistNode) {
        continue;
      }

      touchedArtistKeys.add(artistKey);

      await upsertBrainEdge({
        edgeKey: buildEdgeKey("artist_associates_entity_type", artistNode.id, sourceEntityTypeNode.id),
        edgeType: "artist_associates_entity_type",
        sourceNodeId: artistNode.id,
        targetNodeId: sourceEntityTypeNode.id,
        weight: Math.max(0.68, claim.confidenceScore - 0.08),
        metadata: {
          materializedFromClaimId: claim.id,
          relationshipRole: "source"
        }
      });
      edgeTouches += 1;

      await upsertBrainEdge({
        edgeKey: buildEdgeKey("artist_associates_entity_type", artistNode.id, targetEntityTypeNode.id),
        edgeType: "artist_associates_entity_type",
        sourceNodeId: artistNode.id,
        targetNodeId: targetEntityTypeNode.id,
        weight: Math.max(0.68, claim.confidenceScore - 0.08),
        metadata: {
          materializedFromClaimId: claim.id,
          relationshipRole: "target"
        }
      });
      edgeTouches += 1;

      await upsertBrainEdge({
        edgeKey: buildEdgeKey("entity_type_related_to_entity_type", sourceEntityTypeNode.id, targetEntityTypeNode.id, artistNode.id),
        edgeType: "entity_type_related_to_entity_type",
        sourceNodeId: sourceEntityTypeNode.id,
        targetNodeId: targetEntityTypeNode.id,
        sourceSongId: artistNode.id,
        weight: claim.confidenceScore,
        metadata: {
          artistKey,
          artistNodeId: artistNode.id,
          dynamic,
          dynamicFamilyKey: dynamicFamily?.canonicalKey ?? null,
          dynamicFamilyLabel: dynamicFamily?.displayLabel ?? dynamic,
          powerBalance: asString(claim.payload.powerBalance),
          materializedFromClaimId: claim.id
        },
        evidence: asString(claim.payload.evidence)
      });
      edgeTouches += 1;
    }

    await updateBrainClaim({
      claimId: claim.id,
      payloadMerge: {
        materialization: {
          status: "materialized",
          materializedAt: new Date().toISOString(),
          sourceEntityTypeNodeId: sourceEntityTypeNode.id,
          targetEntityTypeNodeId: targetEntityTypeNode.id,
          dynamic,
          dynamicFamilyKey: dynamicFamily?.canonicalKey ?? null,
          dynamicFamilyLabel: dynamicFamily?.displayLabel ?? dynamic,
          artistKeys,
          claimUpdatedAt: claim.updatedAt ?? null
        }
      }
    });

    claimsMaterialized += 1;
    if (samplePatterns.size < 8) {
      samplePatterns.add(`${sourceRole} -> ${dynamicFamily?.displayLabel ?? dynamic} -> ${targetRole}`);
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
    samplePatterns: Array.from(samplePatterns)
  };
}

export async function materializeAcceptedMotifClaims(
  options: MaterializeAcceptedVocabularyClaimsOptions
): Promise<MaterializeAcceptedMotifClaimsResult> {
  const fallbackArtistKeys = splitArtistCredits(options.draftFile.artist).map((entry) => entry.key);
  const artistClaims = fallbackArtistKeys.length > 0 ? await listBrainClaimsByScope("artist", fallbackArtistKeys, 300) : [];
  const claims = artistClaims.filter((claim) => isMotifClaim(claim) && isAcceptedAndUnmaterialized(claim));

  if (claims.length === 0) {
    return {
      claimsMaterialized: 0,
      nodeTouches: 0,
      edgeTouches: 0,
      invalidatedMemoryPacks: 0,
      currentSongPackRefreshed: false,
      touchedArtistKeys: [],
      sampleMotifs: []
    };
  }

  const touchedArtistKeys = new Set<string>();
  const sampleMotifs = new Set<string>();
  let claimsMaterialized = 0;
  let nodeTouches = 0;
  let edgeTouches = 0;

  for (const claim of claims) {
    const artistKeys = getClaimArtistKeys(claim, fallbackArtistKeys);
    const motif = asString(claim.payload.motif);

    if (!motif) {
      continue;
    }

    const canonicalMotif = canonicalizeBrainMotif(motif);
    const motifKey = canonicalMotif?.canonicalKey ?? normalizeBrainKey(motif);
    const motifLabel = canonicalMotif?.displayLabel ?? motif;
    const policy = evaluateBrainNodePolicy("motif", motifLabel);

    if (!motifKey || policy.scope === "song_local" || !policy.shouldInject) {
      await updateBrainClaim({
        claimId: claim.id,
        payloadMerge: {
          materialization: {
            status: "skipped_non_reusable_motif",
            materializedAt: new Date().toISOString(),
            artistKeys,
            claimUpdatedAt: claim.updatedAt ?? null
          }
        }
      });
      continue;
    }

    const motifNode = await upsertBrainNode({
      nodeType: "motif",
      canonicalKey: motifKey,
      displayLabel: motifLabel,
      aliases: buildBrainAliases([motifLabel, asString(claim.payload.sourceLabel)]),
      description: asString(claim.payload.note),
      metadata: withPolicyMetadata("motif", motifLabel, {
        materializedFromClaimId: claim.id,
        sourceLabel: asString(claim.payload.sourceLabel)
      })
    });

    if (!motifNode) {
      continue;
    }

    nodeTouches += 1;

    for (const artistKey of artistKeys) {
      const artistNode = await readBrainNodeByTypeAndKey("artist", artistKey);

      if (!artistNode) {
        continue;
      }

      touchedArtistKeys.add(artistKey);

      await upsertBrainEdge({
        edgeKey: buildEdgeKey("artist_exhibits_motif", artistNode.id, motifNode.id),
        edgeType: "artist_exhibits_motif",
        sourceNodeId: artistNode.id,
        targetNodeId: motifNode.id,
        weight: Math.max(0.7, claim.confidenceScore),
        metadata: {
          materializedFromClaimId: claim.id,
          sourceLabel: asString(claim.payload.sourceLabel)
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
          motifNodeId: motifNode.id,
          artistKeys,
          claimUpdatedAt: claim.updatedAt ?? null
        }
      }
    });

    claimsMaterialized += 1;
    if (sampleMotifs.size < 8) {
      sampleMotifs.add(motifLabel);
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
    sampleMotifs: Array.from(sampleMotifs)
  };
}

export async function materializeAcceptedPersonaClaims(
  options: MaterializeAcceptedVocabularyClaimsOptions
): Promise<MaterializeAcceptedPersonaClaimsResult> {
  const fallbackArtistKeys = splitArtistCredits(options.draftFile.artist).map((entry) => entry.key);
  const artistClaims = fallbackArtistKeys.length > 0 ? await listBrainClaimsByScope("artist", fallbackArtistKeys, 300) : [];
  const claims = artistClaims.filter((claim) => isPersonaClaim(claim) && isAcceptedAndUnmaterialized(claim));

  if (claims.length === 0) {
    return {
      claimsMaterialized: 0,
      nodeTouches: 0,
      edgeTouches: 0,
      invalidatedMemoryPacks: 0,
      currentSongPackRefreshed: false,
      touchedArtistKeys: [],
      sampleStyles: []
    };
  }

  const touchedArtistKeys = new Set<string>();
  const sampleStyles = new Set<string>();
  let claimsMaterialized = 0;
  let nodeTouches = 0;
  let edgeTouches = 0;

  for (const claim of claims) {
    const artistKeys = getClaimArtistKeys(claim, fallbackArtistKeys);
    const personaStyle = asString(claim.payload.personaStyle);

    if (!personaStyle) {
      continue;
    }

    const canonicalStyle = canonicalizePersonaStyle(personaStyle);
    const styleKey = canonicalStyle?.canonicalKey ?? normalizeBrainKey(personaStyle);
    const styleLabel = canonicalStyle?.displayLabel ?? personaStyle;
    const policy = evaluateBrainNodePolicy("persona_style", styleLabel);

    if (!styleKey || !policy.shouldInject) {
      await updateBrainClaim({
        claimId: claim.id,
        payloadMerge: {
          materialization: {
            status: "skipped_non_reusable_style",
            materializedAt: new Date().toISOString(),
            artistKeys,
            claimUpdatedAt: claim.updatedAt ?? null
          }
        }
      });
      continue;
    }

    const styleNode = await upsertBrainNode({
      nodeType: "persona_style",
      canonicalKey: styleKey,
      displayLabel: styleLabel,
      aliases: buildBrainAliases([
        styleLabel,
        ...(Array.isArray(claim.payload.sourceLabels)
          ? claim.payload.sourceLabels.map((value) => asString(value)).filter((value): value is string => Boolean(value))
          : [])
      ]),
      metadata: withPolicyMetadata("persona_style", styleLabel, {
        materializedFromClaimId: claim.id,
        sourceLabels: claim.payload.sourceLabels
      })
    });

    if (!styleNode) {
      continue;
    }

    nodeTouches += 1;

    for (const artistKey of artistKeys) {
      const artistNode = await readBrainNodeByTypeAndKey("artist", artistKey);

      if (!artistNode) {
        continue;
      }

      touchedArtistKeys.add(artistKey);

      await upsertBrainEdge({
        edgeKey: buildEdgeKey("artist_has_persona_style", artistNode.id, styleNode.id),
        edgeType: "artist_has_persona_style",
        sourceNodeId: artistNode.id,
        targetNodeId: styleNode.id,
        weight: Math.max(0.72, claim.confidenceScore),
        metadata: {
          materializedFromClaimId: claim.id,
          sourceLabels: claim.payload.sourceLabels
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
          personaStyleNodeId: styleNode.id,
          artistKeys,
          claimUpdatedAt: claim.updatedAt ?? null
        }
      }
    });

    claimsMaterialized += 1;
    if (sampleStyles.size < 8) {
      sampleStyles.add(styleLabel);
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
    sampleStyles: Array.from(sampleStyles)
  };
}
