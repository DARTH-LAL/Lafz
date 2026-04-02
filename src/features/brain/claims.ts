import { randomUUID } from "node:crypto";

import type { AiArtistMemory, AiTranslationDraftFile } from "@/features/ai/types";
import type { AiGlossaryEntry } from "@/features/ai/glossary";
import { normalizeLookupText } from "@/features/ai/romanized-normalization";
import { requestOpenAiVocabularyCandidates } from "@/features/ai/openai";
import {
  insertBrainEvidence,
  insertBrainPromotion,
  listBrainPromotionsByClaimIds,
  readBrainClaimsByIds,
  upsertBrainClaim
} from "@/features/brain/repository";
import { applyPolicyWeight, evaluateBrainNodePolicy, summarizePolicy } from "@/features/brain/policy";
import {
  canonicalizeBrainMotif,
  canonicalizePersonaStyle,
  canonicalizeRelationshipDynamic,
  classifyBrainEntity,
  isDirectiveLikePersonaStyleText,
  isGenericSingleTokenPersonaStyle,
  isReusableArtistEntityClass,
  isSentenceLikePersonaStyleText,
  normalizeBrainKey,
  uniqStrings
} from "@/features/brain/normalize";
import type { LafzBrainClaimRecord, LafzBrainPromotionDecision, LafzBrainPromotionRecord } from "@/features/brain/types";

type BrainClaimArtistContext = {
  artistKey: string;
  displayName: string;
  memory: AiArtistMemory | null;
};

type RecordDraftClaimsOptions = {
  draftFile: AiTranslationDraftFile;
  songNodeId: string;
  artists: BrainClaimArtistContext[];
};

type ClaimWriteResult = {
  claimsUpserted: number;
  evidencesInserted: number;
  touchedClaimIds: Set<string>;
};

function buildClaimKey(scopeType: "song" | "artist" | "global", scopeKey: string, claimType: string, normalizedKey: string) {
  return [scopeType, scopeKey, claimType, normalizedKey].join("::");
}

function mergeClaimWriteResults(results: ClaimWriteResult[]) {
  return results.reduce<ClaimWriteResult>(
    (totals, result) => {
      for (const claimId of result.touchedClaimIds) {
        totals.touchedClaimIds.add(claimId);
      }

      totals.claimsUpserted += result.claimsUpserted;
      totals.evidencesInserted += result.evidencesInserted;
      return totals;
    },
    {
      claimsUpserted: 0,
      evidencesInserted: 0,
      touchedClaimIds: new Set<string>()
    }
  );
}

function buildCombinedArtistEntries(memory: AiArtistMemory | null) {
  if (!memory) {
    return [] as AiGlossaryEntry[];
  }

  const canonicalEntries = (memory.canonicalRenderings ?? []).map((entry) => ({
    term: entry.term,
    meaning: entry.rendering,
    note: entry.note,
    aliases: [] as string[],
    category: "preferred_rendering" as const
  }));

  return [...memory.glossaryEntries, ...canonicalEntries];
}

function buildExistingTermBank(artists: BrainClaimArtistContext[]) {
  return uniqStrings(
    artists.flatMap((artist) =>
      buildCombinedArtistEntries(artist.memory).flatMap((entry) => [entry.term, ...(entry.aliases ?? [])])
    )
  );
}

function buildPersonaStyleSignalSources(artistMemory: AiArtistMemory | null, draftFile: AiTranslationDraftFile) {
  const sources: Array<{ value: string; sourceType: "artist_memory" | "world_model" | "song_context"; weight: number }> = [];

  for (const value of uniqStrings([
    artistMemory?.personaSummary,
    ...(artistMemory?.voiceNotes ?? []),
    ...(artistMemory?.stanceNotes ?? []),
    ...(artistMemory?.toneNotes ?? [])
  ])) {
    sources.push({
      value,
      sourceType: "artist_memory",
      weight: artistMemory?.personaSummary === value ? 0.9 : 0.78
    });
  }

  for (const value of uniqStrings([
    draftFile.worldModel?.speakerPersona
  ])) {
    sources.push({
      value,
      sourceType: "world_model",
      weight: 0.82
    });
  }

  return sources;
}

function confidenceLabelToScore(value: "low" | "medium" | "high" | null | undefined) {
  switch (value) {
    case "high":
      return 0.9;
    case "medium":
      return 0.7;
    case "low":
      return 0.45;
    default:
      return 0.6;
  }
}

function salienceLabelToScore(value: "low" | "medium" | "high" | null | undefined) {
  switch (value) {
    case "high":
      return 0.84;
    case "medium":
      return 0.7;
    case "low":
      return 0.52;
    default:
      return 0.62;
  }
}

function buildWorldEntityByKey(options: RecordDraftClaimsOptions) {
  return new Map((options.draftFile.worldModel?.entities ?? []).map((entity) => [entity.entityKey, entity] as const));
}

function getEntityAttributionArtists(options: RecordDraftClaimsOptions) {
  return options.artists.length > 0 ? [options.artists[0]] : [];
}

function getObservedSongIds(claim: LafzBrainClaimRecord) {
  const payloadSongIds = Array.isArray(claim.payload.observedSongIds)
    ? claim.payload.observedSongIds
        .map((value) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null))
        .filter((value): value is string => Boolean(value))
    : [];
  const fallbackTrackId =
    typeof claim.payload.spotifyTrackId === "string" && claim.payload.spotifyTrackId.trim().length > 0
      ? [claim.payload.spotifyTrackId.trim()]
      : [];

  return uniqStrings([...payloadSongIds, ...fallbackTrackId]);
}

function getObservedSongCount(claim: LafzBrainClaimRecord) {
  const observedSongIds = getObservedSongIds(claim);
  return observedSongIds.length > 0 ? observedSongIds.length : claim.sourceCount;
}

function getClaimEntityClass(claim: LafzBrainClaimRecord) {
  const computedClass = classifyBrainEntity(
    typeof claim.payload.entityKey === "string" ? claim.payload.entityKey : null,
    typeof claim.payload.entityRole === "string"
      ? claim.payload.entityRole
      : typeof claim.payload.entityLabel === "string"
        ? claim.payload.entityLabel
        : null,
    typeof claim.payload.description === "string" ? claim.payload.description : null
  );

  if (computedClass !== "other") {
    return computedClass;
  }

  return typeof claim.payload.entityClass === "string" && claim.payload.entityClass.trim().length > 0
    ? claim.payload.entityClass.trim()
    : computedClass;
}

function getClaimSourceEntityClass(claim: LafzBrainClaimRecord) {
  const computedClass = classifyBrainEntity(
    typeof claim.payload.sourceEntityKey === "string" ? claim.payload.sourceEntityKey : null,
    typeof claim.payload.sourceRole === "string" ? claim.payload.sourceRole : null,
    null
  );

  if (computedClass !== "other") {
    return computedClass;
  }

  return typeof claim.payload.sourceEntityClass === "string" && claim.payload.sourceEntityClass.trim().length > 0
    ? claim.payload.sourceEntityClass.trim()
    : computedClass;
}

function getClaimTargetEntityClass(claim: LafzBrainClaimRecord) {
  const computedClass = classifyBrainEntity(
    typeof claim.payload.targetEntityKey === "string" ? claim.payload.targetEntityKey : null,
    typeof claim.payload.targetRole === "string" ? claim.payload.targetRole : null,
    null
  );

  if (computedClass !== "other") {
    return computedClass;
  }

  return typeof claim.payload.targetEntityClass === "string" && claim.payload.targetEntityClass.trim().length > 0
    ? claim.payload.targetEntityClass.trim()
    : computedClass;
}

function getEntityRoleKey(role: string | null | undefined, label: string | null | undefined) {
  return normalizeBrainKey(role) ?? normalizeBrainKey(label);
}

function humanizeEntityKey(entityKey: string | null | undefined) {
  if (!entityKey) {
    return null;
  }

  return entityKey.replace(/[-_]+/g, " ").trim();
}

function findEntityLineOrders(entityKey: string, options: RecordDraftClaimsOptions) {
  const lineOrders = new Set<number>();

  for (const lineModel of options.draftFile.worldModel?.lineModels ?? []) {
    if (lineModel.entityLinks.includes(entityKey) || lineModel.referents.includes(entityKey)) {
      lineOrders.add(lineModel.order);
    }
  }

  return Array.from(lineOrders).sort((left, right) => left - right);
}

function findMatchingLineOrders(entry: AiGlossaryEntry, draftFile: AiTranslationDraftFile) {
  const searchTerms = [entry.term, ...(entry.aliases ?? [])].map((value) => normalizeLookupText(value)).filter(Boolean);

  if (searchTerms.length === 0) {
    return [] as number[];
  }

  return draftFile.lines
    .filter((line) => {
      const haystacks = [line.original, line.normalizedOriginal ?? "", line.meaning, line.impliedMeaning ?? ""]
        .map((value) => normalizeLookupText(value))
        .filter(Boolean);

      return searchTerms.some((term) => haystacks.some((haystack) => haystack.includes(term)));
    })
    .map((line) => line.order);
}

async function recordSongMotifClaims(options: RecordDraftClaimsOptions, agentSessionId: string) {
  const motifs = uniqStrings([...(options.draftFile.songContext?.themes ?? []), ...(options.draftFile.worldModel?.coreMotifs ?? [])]);
  const result: ClaimWriteResult = { claimsUpserted: 0, evidencesInserted: 0, touchedClaimIds: new Set<string>() };

  for (const motif of motifs) {
    const canonicalMotif = canonicalizeBrainMotif(motif);
    const normalizedKey = canonicalMotif?.canonicalKey ?? normalizeBrainKey(motif);

    if (!normalizedKey) {
      continue;
    }

    const displayLabel = canonicalMotif?.displayLabel ?? motif;
    const policy = evaluateBrainNodePolicy("motif", displayLabel);
    const claim = await upsertBrainClaim({
      claimKey: buildClaimKey("song", options.draftFile.spotifyTrackId, "song_motif_observation", normalizedKey),
      claimType: "song_motif_observation",
      scopeType: "song",
      scopeKey: options.draftFile.spotifyTrackId,
      normalizedKey,
      confidenceScore: applyPolicyWeight(0.8, policy),
      agentSessionId,
      payload: {
        spotifyTrackId: options.draftFile.spotifyTrackId,
        songNodeId: options.songNodeId,
        title: options.draftFile.title,
        artist: options.draftFile.artist,
        motif: displayLabel,
        sourceLanguage: options.draftFile.sourceLanguage,
        policy: summarizePolicy(policy)
      }
    });

    if (!claim) {
      continue;
    }

    result.claimsUpserted += 1;
    result.touchedClaimIds.add(claim.id);

    if (options.draftFile.songContext?.themes.includes(motif)) {
      const evidence = await insertBrainEvidence({
        claimId: claim.id,
        sourceType: "song_context",
        spotifyTrackId: options.draftFile.spotifyTrackId,
        weight: 0.72,
        agentSessionId,
        payload: {
          source: "song_context",
          motif,
          summary: options.draftFile.songContext.summary
        }
      });
      if (evidence) {
        result.evidencesInserted += 1;
      }
    }

    if (options.draftFile.worldModel?.coreMotifs.includes(motif)) {
      const evidence = await insertBrainEvidence({
        claimId: claim.id,
        sourceType: "world_model",
        spotifyTrackId: options.draftFile.spotifyTrackId,
        weight: 0.84,
        agentSessionId,
        payload: {
          source: "world_model",
          motif,
          summary: options.draftFile.worldModel.summary
        }
      });
      if (evidence) {
        result.evidencesInserted += 1;
      }
    }
  }

  return result;
}

async function recordArtistMotifPatternClaims(options: RecordDraftClaimsOptions, agentSessionId: string) {
  const motifs = uniqStrings([...(options.draftFile.songContext?.themes ?? []), ...(options.draftFile.worldModel?.coreMotifs ?? [])]);
  const attributedArtists = getEntityAttributionArtists(options);
  const attributionMode = options.artists.length > 1 ? "primary_artist_only" : "single_artist";
  const result: ClaimWriteResult = { claimsUpserted: 0, evidencesInserted: 0, touchedClaimIds: new Set<string>() };

  for (const artist of attributedArtists) {
    const recurringArtistMotifs = new Set(
      uniqStrings(artist.memory?.recurringMotifs ?? [])
        .map((value) => canonicalizeBrainMotif(value)?.canonicalKey ?? normalizeBrainKey(value))
        .filter((value): value is string => Boolean(value))
    );

    for (const motif of motifs) {
      const canonicalMotif = canonicalizeBrainMotif(motif);
      const normalizedKey = canonicalMotif?.canonicalKey ?? normalizeBrainKey(motif);

      if (!normalizedKey) {
        continue;
      }

      const displayLabel = canonicalMotif?.displayLabel ?? motif;
      const policy = evaluateBrainNodePolicy("motif", displayLabel);
      const inSongContext = options.draftFile.songContext?.themes.includes(motif) ?? false;
      const inWorldModel = options.draftFile.worldModel?.coreMotifs.includes(motif) ?? false;
      const inArtistMemory = recurringArtistMotifs.has(normalizedKey);
      const baseConfidence = 0.56 + (inSongContext ? 0.1 : 0) + (inWorldModel ? 0.14 : 0) + (inArtistMemory ? 0.08 : 0);

      const claim = await upsertBrainClaim({
        claimKey: buildClaimKey("artist", artist.artistKey, "artist_motif_pattern_observation", normalizedKey),
        claimType: "artist_motif_pattern_observation",
        scopeType: "artist",
        scopeKey: artist.artistKey,
        normalizedKey,
        confidenceScore: applyPolicyWeight(baseConfidence, policy),
        agentSessionId,
        payload: {
          artistKey: artist.artistKey,
          artistName: artist.displayName,
          spotifyTrackId: options.draftFile.spotifyTrackId,
          observedSongIds: [options.draftFile.spotifyTrackId],
          songNodeId: options.songNodeId,
          title: options.draftFile.title,
          motif: displayLabel,
          sourceLabel: canonicalMotif?.sourceLabel ?? motif,
          attributionMode,
          sourceLanguage: options.draftFile.sourceLanguage,
          policy: summarizePolicy(policy)
        }
      });

      if (!claim) {
        continue;
      }

      result.claimsUpserted += 1;
      result.touchedClaimIds.add(claim.id);

      if (inSongContext) {
        const evidence = await insertBrainEvidence({
          claimId: claim.id,
          sourceType: "song_context",
          spotifyTrackId: options.draftFile.spotifyTrackId,
          artistKey: artist.artistKey,
          weight: 0.74,
          agentSessionId,
          payload: {
            source: "song_context",
            motif: displayLabel,
            summary: options.draftFile.songContext?.summary ?? null
          }
        });
        if (evidence) {
          result.evidencesInserted += 1;
        }
      }

      if (inWorldModel) {
        const evidence = await insertBrainEvidence({
          claimId: claim.id,
          sourceType: "world_model",
          spotifyTrackId: options.draftFile.spotifyTrackId,
          artistKey: artist.artistKey,
          weight: 0.82,
          agentSessionId,
          payload: {
            source: "world_model",
            motif: displayLabel,
            summary: options.draftFile.worldModel?.summary ?? null
          }
        });
        if (evidence) {
          result.evidencesInserted += 1;
        }
      }

      if (inArtistMemory) {
        const evidence = await insertBrainEvidence({
          claimId: claim.id,
          sourceType: "artist_memory",
          spotifyTrackId: options.draftFile.spotifyTrackId,
          artistKey: artist.artistKey,
          weight: 0.78,
          agentSessionId,
          payload: {
            source: "artist_memory",
            motif: displayLabel,
            artistMemoryRecurringMotifs: artist.memory?.recurringMotifs ?? []
          }
        });
        if (evidence) {
          result.evidencesInserted += 1;
        }
      }
    }
  }

  return result;
}

async function recordArtistPersonaStyleClaims(options: RecordDraftClaimsOptions, agentSessionId: string) {
  const attributedArtists = getEntityAttributionArtists(options);
  const attributionMode = options.artists.length > 1 ? "primary_artist_only" : "single_artist";
  const result: ClaimWriteResult = { claimsUpserted: 0, evidencesInserted: 0, touchedClaimIds: new Set<string>() };

  for (const artist of attributedArtists) {
    const signalSources = buildPersonaStyleSignalSources(artist.memory, options.draftFile);
    const groupedSignals = new Map<
      string,
      {
        displayLabel: string;
        sourceLabels: Set<string>;
        evidence: Array<{ sourceType: "artist_memory" | "world_model" | "song_context"; weight: number; value: string }>;
      }
    >();

    for (const signal of signalSources) {
      if (isDirectiveLikePersonaStyleText(signal.value) || isGenericSingleTokenPersonaStyle(signal.value)) {
        continue;
      }

      const canonical = canonicalizePersonaStyle(signal.value);
      const displayLabel = canonical?.displayLabel ?? signal.value;
      const normalizedKey = canonical?.canonicalKey ?? normalizeBrainKey(displayLabel);

      if (!normalizedKey || (!canonical && isSentenceLikePersonaStyleText(signal.value))) {
        continue;
      }

      const policy = evaluateBrainNodePolicy("persona_style", displayLabel);

      if (!policy.shouldInject) {
        continue;
      }

      const bucket = groupedSignals.get(normalizedKey) ?? {
        displayLabel,
        sourceLabels: new Set<string>(),
        evidence: []
      };
      bucket.displayLabel = displayLabel;
      bucket.sourceLabels.add(canonical?.sourceLabel ?? signal.value);
      bucket.evidence.push({
        sourceType: signal.sourceType,
        weight: signal.weight,
        value: signal.value
      });
      groupedSignals.set(normalizedKey, bucket);
    }

    for (const [normalizedKey, personaSignal] of groupedSignals.entries()) {
      const policy = evaluateBrainNodePolicy("persona_style", personaSignal.displayLabel);
      const confidenceBoost = personaSignal.evidence.some((entry) => entry.sourceType === "world_model") ? 0.08 : 0;
      const artistMemoryBoost = personaSignal.evidence.filter((entry) => entry.sourceType === "artist_memory").length * 0.04;
      const baseConfidence = 0.56 + confidenceBoost + artistMemoryBoost;

      const claim = await upsertBrainClaim({
        claimKey: buildClaimKey("artist", artist.artistKey, "artist_persona_style_observation", normalizedKey),
        claimType: "artist_persona_style_observation",
        scopeType: "artist",
        scopeKey: artist.artistKey,
        normalizedKey,
        confidenceScore: applyPolicyWeight(baseConfidence, policy),
        agentSessionId,
        payload: {
          artistKey: artist.artistKey,
          artistName: artist.displayName,
          spotifyTrackId: options.draftFile.spotifyTrackId,
          observedSongIds: [options.draftFile.spotifyTrackId],
          songNodeId: options.songNodeId,
          personaStyle: personaSignal.displayLabel,
          sourceLabels: Array.from(personaSignal.sourceLabels),
          attributionMode,
          sourceLanguage: options.draftFile.sourceLanguage,
          policy: summarizePolicy(policy)
        }
      });

      if (!claim) {
        continue;
      }

      result.claimsUpserted += 1;
      result.touchedClaimIds.add(claim.id);

      for (const evidenceSignal of personaSignal.evidence.slice(0, 5)) {
        const evidence = await insertBrainEvidence({
          claimId: claim.id,
          sourceType: evidenceSignal.sourceType,
          spotifyTrackId: options.draftFile.spotifyTrackId,
          artistKey: artist.artistKey,
          weight: evidenceSignal.weight,
          agentSessionId,
          payload: {
            personaStyle: personaSignal.displayLabel,
            sourceValue: evidenceSignal.value,
            sourceLabels: Array.from(personaSignal.sourceLabels)
          }
        });

        if (evidence) {
          result.evidencesInserted += 1;
        }
      }
    }
  }

  return result;
}

async function recordSongSymbolClaims(options: RecordDraftClaimsOptions, agentSessionId: string) {
  const symbols = uniqStrings(options.draftFile.worldModel?.recurringSymbols ?? []);
  const result: ClaimWriteResult = { claimsUpserted: 0, evidencesInserted: 0, touchedClaimIds: new Set<string>() };

  for (const symbol of symbols) {
    const normalizedKey = normalizeBrainKey(symbol);

    if (!normalizedKey) {
      continue;
    }

    const policy = evaluateBrainNodePolicy("symbol", symbol);
    const claim = await upsertBrainClaim({
      claimKey: buildClaimKey("song", options.draftFile.spotifyTrackId, "song_symbol_observation", normalizedKey),
      claimType: "song_symbol_observation",
      scopeType: "song",
      scopeKey: options.draftFile.spotifyTrackId,
      normalizedKey,
      confidenceScore: applyPolicyWeight(0.74, policy),
      agentSessionId,
      payload: {
        spotifyTrackId: options.draftFile.spotifyTrackId,
        songNodeId: options.songNodeId,
        title: options.draftFile.title,
        artist: options.draftFile.artist,
        symbol,
        sourceLanguage: options.draftFile.sourceLanguage,
        policy: summarizePolicy(policy)
      }
    });

    if (!claim) {
      continue;
    }

    result.claimsUpserted += 1;
    result.touchedClaimIds.add(claim.id);

    const evidence = await insertBrainEvidence({
      claimId: claim.id,
      sourceType: "world_model",
      spotifyTrackId: options.draftFile.spotifyTrackId,
      weight: 0.78,
      agentSessionId,
      payload: {
        source: "world_model",
        symbol,
        summary: options.draftFile.worldModel?.summary ?? null
      }
    });

    if (evidence) {
      result.evidencesInserted += 1;
    }
  }

  return result;
}

async function recordRelationshipClaims(options: RecordDraftClaimsOptions, agentSessionId: string) {
  const relationships = options.draftFile.worldModel?.relationshipGraph ?? [];
  const result: ClaimWriteResult = { claimsUpserted: 0, evidencesInserted: 0, touchedClaimIds: new Set<string>() };

  for (const relationship of relationships) {
    const normalizedKey = [
      normalizeBrainKey(relationship.sourceEntity) ?? relationship.sourceEntity,
      normalizeBrainKey(relationship.dynamic) ?? relationship.dynamic,
      normalizeBrainKey(relationship.targetEntity) ?? relationship.targetEntity
    ].join("::");

    const claim = await upsertBrainClaim({
      claimKey: buildClaimKey("song", options.draftFile.spotifyTrackId, "song_relationship_observation", normalizedKey),
      claimType: "song_relationship_observation",
      scopeType: "song",
      scopeKey: options.draftFile.spotifyTrackId,
      normalizedKey,
      confidenceScore: confidenceLabelToScore(relationship.confidence),
      agentSessionId,
      payload: {
        spotifyTrackId: options.draftFile.spotifyTrackId,
        songNodeId: options.songNodeId,
        title: options.draftFile.title,
        artist: options.draftFile.artist,
        sourceEntity: relationship.sourceEntity,
        targetEntity: relationship.targetEntity,
        dynamic: relationship.dynamic,
        powerBalance: relationship.powerBalance,
        confidence: relationship.confidence
      }
    });

    if (!claim) {
      continue;
    }

    result.claimsUpserted += 1;
    result.touchedClaimIds.add(claim.id);

    const evidence = await insertBrainEvidence({
      claimId: claim.id,
      sourceType: "world_model",
      spotifyTrackId: options.draftFile.spotifyTrackId,
      weight: confidenceLabelToScore(relationship.confidence),
      agentSessionId,
      payload: {
        source: "world_model",
        sourceEntity: relationship.sourceEntity,
        targetEntity: relationship.targetEntity,
        dynamic: relationship.dynamic,
        powerBalance: relationship.powerBalance,
        evidence: relationship.evidence
      }
    });

    if (evidence) {
      result.evidencesInserted += 1;
    }
  }

  return result;
}

async function recordArtistEntityRoleClaims(options: RecordDraftClaimsOptions, agentSessionId: string) {
  const result: ClaimWriteResult = { claimsUpserted: 0, evidencesInserted: 0, touchedClaimIds: new Set<string>() };
  const entityByKey = buildWorldEntityByKey(options);
  const attributedArtists = getEntityAttributionArtists(options);
  const attributionMode = options.artists.length > 1 ? "primary_artist_only" : "single_artist";

  for (const artist of attributedArtists) {
    for (const entity of options.draftFile.worldModel?.entities ?? []) {
      const roleKey = normalizeBrainKey(entity.entityKey) ?? getEntityRoleKey(entity.role, entity.label);
      const roleLabel = humanizeEntityKey(entity.entityKey) ?? entity.role ?? entity.label;
      const entityClass = classifyBrainEntity(entity.entityKey, entity.label, entity.description);
      const reusableEntityClass = isReusableArtistEntityClass(entityClass);

      if (!roleKey || !roleLabel) {
        continue;
      }

      const lineOrders = findEntityLineOrders(entity.entityKey, options);
      const claim = await upsertBrainClaim({
        claimKey: buildClaimKey("artist", artist.artistKey, "artist_entity_role_observation", roleKey),
        claimType: "artist_entity_role_observation",
        scopeType: "artist",
        scopeKey: artist.artistKey,
        normalizedKey: roleKey,
        confidenceScore: Math.max(0.4, salienceLabelToScore(entity.salience) - (reusableEntityClass ? 0 : 0.14)),
        agentSessionId,
        payload: {
          artistKey: artist.artistKey,
          artistName: artist.displayName,
          spotifyTrackId: options.draftFile.spotifyTrackId,
          observedSongIds: [options.draftFile.spotifyTrackId],
          songNodeId: options.songNodeId,
          entityKey: entity.entityKey,
          entityLabel: entity.label,
          entityRole: roleLabel,
          entityClass,
          attributionMode,
          aliases: entity.aliases,
          description: entity.description,
          salience: entity.salience,
          lineOrders,
          sourceLanguage: options.draftFile.sourceLanguage
        }
      });

      if (!claim) {
        continue;
      }

      result.claimsUpserted += 1;
      result.touchedClaimIds.add(claim.id);

      const worldModelEvidence = await insertBrainEvidence({
        claimId: claim.id,
        sourceType: "world_model",
        spotifyTrackId: options.draftFile.spotifyTrackId,
        artistKey: artist.artistKey,
        weight: salienceLabelToScore(entity.salience),
        agentSessionId,
        payload: {
          entityKey: entity.entityKey,
          entityLabel: entity.label,
          entityRole: roleLabel,
          aliases: entity.aliases,
          description: entity.description,
          salience: entity.salience
        }
      });

      if (worldModelEvidence) {
        result.evidencesInserted += 1;
      }

      for (const lineOrder of lineOrders.slice(0, 4)) {
        const line = options.draftFile.lines[lineOrder];

        if (!line) {
          continue;
        }

        const evidence = await insertBrainEvidence({
          claimId: claim.id,
          sourceType: "draft_line",
          spotifyTrackId: options.draftFile.spotifyTrackId,
          artistKey: artist.artistKey,
          lineOrder,
          weight: 0.72,
          agentSessionId,
          payload: {
            entityKey: entity.entityKey,
            entityLabel: entity.label,
            entityRole: roleLabel,
            original: line.original,
            chosen: line.chosen,
            meaning: line.meaning
          }
        });

        if (evidence) {
          result.evidencesInserted += 1;
        }
      }
    }

    for (const relationship of options.draftFile.worldModel?.relationshipGraph ?? []) {
      const sourceEntity = entityByKey.get(relationship.sourceEntity) ?? null;
      const targetEntity = entityByKey.get(relationship.targetEntity) ?? null;
      const sourceEntityClass = classifyBrainEntity(
        sourceEntity?.entityKey ?? relationship.sourceEntity,
        sourceEntity?.label ?? relationship.sourceEntity,
        sourceEntity?.description ?? null
      );
      const targetEntityClass = classifyBrainEntity(
        targetEntity?.entityKey ?? relationship.targetEntity,
        targetEntity?.label ?? relationship.targetEntity,
        targetEntity?.description ?? null
      );
      const sourceRole =
        humanizeEntityKey(sourceEntity?.entityKey ?? relationship.sourceEntity) ??
        sourceEntity?.role ??
        sourceEntity?.label ??
        relationship.sourceEntity;
      const targetRole =
        humanizeEntityKey(targetEntity?.entityKey ?? relationship.targetEntity) ??
        targetEntity?.role ??
        targetEntity?.label ??
        relationship.targetEntity;
      const sourceRoleKey =
        normalizeBrainKey(sourceEntity?.entityKey ?? relationship.sourceEntity) ??
        getEntityRoleKey(sourceEntity?.role ?? null, sourceEntity?.label ?? relationship.sourceEntity);
      const targetRoleKey =
        normalizeBrainKey(targetEntity?.entityKey ?? relationship.targetEntity) ??
        getEntityRoleKey(targetEntity?.role ?? null, targetEntity?.label ?? relationship.targetEntity);
      const dynamicFamily = canonicalizeRelationshipDynamic(
        relationship.dynamic,
        sourceEntity?.entityKey ?? relationship.sourceEntity,
        targetEntity?.entityKey ?? relationship.targetEntity
      );
      const dynamicKey = dynamicFamily?.canonicalKey ?? normalizeBrainKey(relationship.dynamic);
      const reusablePattern =
        isReusableArtistEntityClass(sourceEntityClass) && isReusableArtistEntityClass(targetEntityClass);

      if (!sourceRoleKey || !targetRoleKey || !dynamicKey) {
        continue;
      }

      const relationshipLineOrders = uniqStrings(
        (options.draftFile.worldModel?.lineModels ?? [])
          .filter((lineModel) => {
            const links = new Set([...lineModel.entityLinks, ...lineModel.referents]);
            return links.has(relationship.sourceEntity) || links.has(relationship.targetEntity);
          })
          .map((lineModel) => String(lineModel.order))
      ).map((value) => Number.parseInt(value, 10)).filter((value) => Number.isFinite(value));

      const claim = await upsertBrainClaim({
        claimKey: buildClaimKey(
          "artist",
          artist.artistKey,
          "artist_relationship_pattern_observation",
          `${sourceRoleKey}::${dynamicKey}::${targetRoleKey}`
        ),
        claimType: "artist_relationship_pattern_observation",
        scopeType: "artist",
        scopeKey: artist.artistKey,
        normalizedKey: `${sourceRoleKey}::${dynamicKey}::${targetRoleKey}`,
        confidenceScore: Math.max(
          confidenceLabelToScore(relationship.confidence),
          salienceLabelToScore(sourceEntity?.salience ?? null),
          salienceLabelToScore(targetEntity?.salience ?? null)
        ) - (reusablePattern ? 0 : 0.14),
        agentSessionId,
        payload: {
          artistKey: artist.artistKey,
          artistName: artist.displayName,
          spotifyTrackId: options.draftFile.spotifyTrackId,
          observedSongIds: [options.draftFile.spotifyTrackId],
          songNodeId: options.songNodeId,
          sourceEntityKey: relationship.sourceEntity,
          targetEntityKey: relationship.targetEntity,
          sourceRole,
          targetRole,
          sourceEntityClass,
          targetEntityClass,
          dynamic: relationship.dynamic,
          dynamicFamilyKey: dynamicFamily?.canonicalKey ?? null,
          dynamicFamilyLabel: dynamicFamily?.displayLabel ?? relationship.dynamic,
          powerBalance: relationship.powerBalance,
          confidence: relationship.confidence,
          evidence: relationship.evidence,
          attributionMode,
          lineOrders: relationshipLineOrders,
          sourceLanguage: options.draftFile.sourceLanguage
        }
      });

      if (!claim) {
        continue;
      }

      result.claimsUpserted += 1;
      result.touchedClaimIds.add(claim.id);

      const worldModelEvidence = await insertBrainEvidence({
        claimId: claim.id,
        sourceType: "world_model",
        spotifyTrackId: options.draftFile.spotifyTrackId,
        artistKey: artist.artistKey,
        weight: confidenceLabelToScore(relationship.confidence),
        agentSessionId,
        payload: {
          sourceRole,
          targetRole,
          dynamic: relationship.dynamic,
          powerBalance: relationship.powerBalance,
          evidence: relationship.evidence
        }
      });

      if (worldModelEvidence) {
        result.evidencesInserted += 1;
      }

      for (const lineOrder of relationshipLineOrders.slice(0, 4)) {
        const line = options.draftFile.lines[lineOrder];

        if (!line) {
          continue;
        }

        const evidence = await insertBrainEvidence({
          claimId: claim.id,
          sourceType: "draft_line",
          spotifyTrackId: options.draftFile.spotifyTrackId,
          artistKey: artist.artistKey,
          lineOrder,
          weight: 0.74,
          agentSessionId,
          payload: {
            sourceRole,
            targetRole,
            dynamic: relationship.dynamic,
            original: line.original,
            chosen: line.chosen,
            meaning: line.meaning
          }
        });

        if (evidence) {
          result.evidencesInserted += 1;
        }
      }
    }
  }

  return result;
}

async function recordArtistTermUsageClaims(options: RecordDraftClaimsOptions, agentSessionId: string) {
  const result: ClaimWriteResult = { claimsUpserted: 0, evidencesInserted: 0, touchedClaimIds: new Set<string>() };

  for (const artist of options.artists) {
    const entries = buildCombinedArtistEntries(artist.memory);

    for (const entry of entries) {
      const termKey = normalizeBrainKey(entry.term);
      const meaningKey = normalizeBrainKey(entry.meaning);
      const matchingLineOrders = findMatchingLineOrders(entry, options.draftFile);

      if (!termKey || !meaningKey || matchingLineOrders.length === 0) {
        continue;
      }

      const claim = await upsertBrainClaim({
        claimKey: buildClaimKey("artist", artist.artistKey, "artist_term_usage_observation", `${termKey}::${meaningKey}`),
        claimType: "artist_term_usage_observation",
        scopeType: "artist",
        scopeKey: artist.artistKey,
        normalizedKey: `${termKey}::${meaningKey}`,
        confidenceScore: entry.category === "preferred_rendering" ? 0.9 : 0.74,
        agentSessionId,
        payload: {
          artistKey: artist.artistKey,
          artistName: artist.displayName,
          spotifyTrackId: options.draftFile.spotifyTrackId,
          term: entry.term,
          meaning: entry.meaning,
          note: entry.note ?? null,
          aliases: entry.aliases ?? [],
          category: entry.category ?? "entry",
          sourceLanguage: options.draftFile.sourceLanguage
        }
      });

      if (!claim) {
        continue;
      }

      result.claimsUpserted += 1;
      result.touchedClaimIds.add(claim.id);

      for (const order of matchingLineOrders) {
        const line = options.draftFile.lines[order];
        if (!line) {
          continue;
        }

        const evidence = await insertBrainEvidence({
          claimId: claim.id,
          sourceType: "draft_line",
          spotifyTrackId: options.draftFile.spotifyTrackId,
          artistKey: artist.artistKey,
          lineOrder: order,
          weight: entry.category === "preferred_rendering" ? 0.86 : 0.7,
          agentSessionId,
          payload: {
            original: line.original,
            normalizedOriginal: line.normalizedOriginal,
            meaning: line.meaning,
            impliedMeaning: line.impliedMeaning,
            chosen: line.chosen,
            term: entry.term,
            meaningHint: entry.meaning,
            note: entry.note ?? null,
            category: entry.category ?? "entry"
          }
        });

        if (evidence) {
          result.evidencesInserted += 1;
        }
      }

      const memoryEvidence = await insertBrainEvidence({
        claimId: claim.id,
        sourceType: "artist_memory",
        spotifyTrackId: options.draftFile.spotifyTrackId,
        artistKey: artist.artistKey,
        weight: entry.category === "preferred_rendering" ? 0.92 : 0.68,
        agentSessionId,
        payload: {
          term: entry.term,
          meaning: entry.meaning,
          note: entry.note ?? null,
          aliases: entry.aliases ?? [],
          category: entry.category ?? "entry"
        }
      });

      if (memoryEvidence) {
        result.evidencesInserted += 1;
      }
    }
  }

  return result;
}

async function recordDiscoveredVocabularyClaims(options: RecordDraftClaimsOptions, agentSessionId: string) {
  const primaryArtist = options.artists[0] ?? null;

  if (!primaryArtist) {
    return { claimsUpserted: 0, evidencesInserted: 0, touchedClaimIds: new Set<string>() } satisfies ClaimWriteResult;
  }

  const draftLineByOrder = new Map(options.draftFile.lines.map((line) => [line.order, line] as const));
  const result: ClaimWriteResult = { claimsUpserted: 0, evidencesInserted: 0, touchedClaimIds: new Set<string>() };

  const discovery = await requestOpenAiVocabularyCandidates({
    title: options.draftFile.title,
    artist: options.draftFile.artist,
    album: options.draftFile.album,
    sourceLanguage: options.draftFile.sourceLanguage,
    targetLanguage: options.draftFile.targetLanguage,
    glossaryEntries: [],
    artistMemory: primaryArtist.memory,
    songContext: options.draftFile.songContext,
    worldModel: options.draftFile.worldModel,
    existingTerms: buildExistingTermBank(options.artists),
    lines: options.draftFile.lines.map((line) => ({
      order: line.order,
      original: line.original,
      normalizedOriginal: line.normalizedOriginal,
      meaning: line.meaning,
      impliedMeaning: line.impliedMeaning,
      chosen: line.chosen,
      note: line.note,
      confidence: line.confidence
    }))
  });

  for (const candidate of discovery.candidates) {
    const termKey = normalizeBrainKey(candidate.term);
    const meaningKey = normalizeBrainKey(candidate.meaning);

    if (!termKey || !meaningKey) {
      continue;
    }

    const claim = await upsertBrainClaim({
      claimKey: buildClaimKey("song", options.draftFile.spotifyTrackId, "song_vocabulary_observation", `${termKey}::${meaningKey}`),
      claimType: "song_vocabulary_observation",
      scopeType: "song",
      scopeKey: options.draftFile.spotifyTrackId,
      normalizedKey: `${termKey}::${meaningKey}`,
      confidenceScore: confidenceLabelToScore(candidate.confidence),
      agentSessionId,
      payload: {
        spotifyTrackId: options.draftFile.spotifyTrackId,
        songNodeId: options.songNodeId,
        title: options.draftFile.title,
        artist: options.draftFile.artist,
        artistKey: primaryArtist.artistKey,
        term: candidate.term,
        meaning: candidate.meaning,
        aliases: candidate.aliases,
        note: candidate.note,
        category: candidate.category,
        lineOrders: candidate.lineOrders,
        sourceLanguage: discovery.sourceLanguage
      }
    });

    if (!claim) {
      continue;
    }

    result.claimsUpserted += 1;
    result.touchedClaimIds.add(claim.id);

    const extractorEvidence = await insertBrainEvidence({
      claimId: claim.id,
      sourceType: "vocabulary_extractor",
      spotifyTrackId: options.draftFile.spotifyTrackId,
      artistKey: primaryArtist.artistKey,
      weight: confidenceLabelToScore(candidate.confidence),
      agentSessionId,
      payload: {
        source: "openai_vocabulary_extractor",
        term: candidate.term,
        meaning: candidate.meaning,
        aliases: candidate.aliases,
        note: candidate.note,
        category: candidate.category,
        lineOrders: candidate.lineOrders
      }
    });

    if (extractorEvidence) {
      result.evidencesInserted += 1;
    }

    for (const lineOrder of candidate.lineOrders) {
      const line = draftLineByOrder.get(lineOrder);

      if (!line) {
        continue;
      }

      const evidence = await insertBrainEvidence({
        claimId: claim.id,
        sourceType: "draft_line",
        spotifyTrackId: options.draftFile.spotifyTrackId,
        artistKey: primaryArtist.artistKey,
        lineOrder,
        weight: 0.72,
        agentSessionId,
        payload: {
          original: line.original,
          normalizedOriginal: line.normalizedOriginal,
          meaning: line.meaning,
          impliedMeaning: line.impliedMeaning,
          chosen: line.chosen,
          note: line.note,
          candidateTerm: candidate.term,
          candidateMeaning: candidate.meaning
        }
      });

      if (evidence) {
        result.evidencesInserted += 1;
      }
    }
  }

  return result;
}

function getLatestPromotionByClaimId(promotions: LafzBrainPromotionRecord[]) {
  const latest = new Map<string, LafzBrainPromotionRecord>();

  for (const promotion of promotions) {
    if (!latest.has(promotion.claimId)) {
      latest.set(promotion.claimId, promotion);
    }
  }

  return latest;
}

function decidePromotionForClaim(claim: LafzBrainClaimRecord) {
  const policy = claim.payload.policy as { shouldInject?: boolean; scope?: string } | undefined;
  const shouldInject = policy?.shouldInject !== false;

  switch (claim.claimType) {
    case "song_motif_observation":
      if (claim.confidenceScore >= 0.72 && claim.evidenceCount >= 2) {
        return {
          decision: "accepted" as LafzBrainPromotionDecision,
          reason: "Strong motif observation supported by both song context and world model."
        };
      }
      if (!shouldInject && claim.confidenceScore < 0.82) {
        return {
          decision: "deferred" as LafzBrainPromotionDecision,
          reason: "Song-local or broad motif kept as a proposed observation for now."
        };
      }
      if (claim.confidenceScore < 0.4) {
        return {
          decision: "rejected" as LafzBrainPromotionDecision,
          reason: "Motif observation is too weak to keep active."
        };
      }
      return {
        decision: "deferred" as LafzBrainPromotionDecision,
        reason: "Needs more repeated support before acceptance."
      };

    case "artist_motif_pattern_observation":
      {
        const observedSongCount = getObservedSongCount(claim);

        if (
          shouldInject &&
          claim.evidenceCount >= 2 &&
          ((observedSongCount >= 2 && claim.confidenceScore >= 0.58) ||
            (observedSongCount >= 3 && claim.confidenceScore >= 0.54))
        ) {
          return {
            decision: "accepted" as LafzBrainPromotionDecision,
            reason: "Artist motif pattern repeats across songs strongly enough to become reusable motif memory."
          };
        }
        if (!shouldInject) {
          return {
            decision: "deferred" as LafzBrainPromotionDecision,
            reason: "Keep broad or song-local motif patterns as observations until stronger reuse appears."
          };
        }
        if (claim.confidenceScore < 0.48 && observedSongCount <= 1 && claim.evidenceCount <= 1) {
          return {
            decision: "rejected" as LafzBrainPromotionDecision,
            reason: "Artist motif pattern is too weak to trust."
          };
        }
        return {
          decision: "deferred" as LafzBrainPromotionDecision,
          reason: "Motif pattern needs more repeated cross-song support before promotion."
        };
      }

    case "artist_persona_style_observation":
      {
        const observedSongCount = getObservedSongCount(claim);

        if (
          shouldInject &&
          claim.evidenceCount >= 2 &&
          ((observedSongCount >= 2 && claim.confidenceScore >= 0.6) ||
            (observedSongCount >= 3 && claim.confidenceScore >= 0.56))
        ) {
          return {
            decision: "accepted" as LafzBrainPromotionDecision,
            reason: "Artist persona style repeats strongly enough to become reusable style memory."
          };
        }
        if (!shouldInject) {
          return {
            decision: "deferred" as LafzBrainPromotionDecision,
            reason: "Keep broad or generic persona styles as observations until stronger artist-specific reuse appears."
          };
        }
        if (claim.confidenceScore < 0.48 && observedSongCount <= 1 && claim.evidenceCount <= 1) {
          return {
            decision: "rejected" as LafzBrainPromotionDecision,
            reason: "Persona style signal is too generic or weak to trust."
          };
        }
        return {
          decision: "deferred" as LafzBrainPromotionDecision,
          reason: "Persona style needs more repeated cross-song support before promotion."
        };
      }

    case "song_symbol_observation":
      if (claim.confidenceScore >= 0.74 && claim.evidenceCount >= 1 && shouldInject) {
        return {
          decision: "accepted" as LafzBrainPromotionDecision,
          reason: "Specific recurring symbol observation is strong enough to trust."
        };
      }
      if (claim.confidenceScore < 0.38) {
        return {
          decision: "rejected" as LafzBrainPromotionDecision,
          reason: "Symbol observation is too generic or weak."
        };
      }
      return {
        decision: "deferred" as LafzBrainPromotionDecision,
        reason: "Keep as a proposed symbol until more specific support appears."
      };

    case "song_relationship_observation":
      if (claim.confidenceScore >= 0.7 && claim.evidenceCount >= 1) {
        return {
          decision: "accepted" as LafzBrainPromotionDecision,
          reason: "Relationship observation is strong enough to trust for this song."
        };
      }
      if (claim.confidenceScore < 0.4) {
        return {
          decision: "rejected" as LafzBrainPromotionDecision,
          reason: "Relationship observation is too uncertain."
        };
      }
      return {
        decision: "deferred" as LafzBrainPromotionDecision,
        reason: "Relationship observation needs stronger signal."
      };

    case "artist_entity_role_observation":
      if (
        isReusableArtistEntityClass(getClaimEntityClass(claim)) &&
        claim.confidenceScore >= 0.72 &&
        getObservedSongCount(claim) >= 2 &&
        claim.evidenceCount >= 3
      ) {
        return {
          decision: "accepted" as LafzBrainPromotionDecision,
          reason: "Artist entity role recurs strongly enough to become reusable brain memory."
        };
      }
      if (!isReusableArtistEntityClass(getClaimEntityClass(claim))) {
        return {
          decision: "deferred" as LafzBrainPromotionDecision,
          reason: "Keep symbolic or abstract entity roles as observations until Lafz sees stronger repeated cross-song support."
        };
      }
      if (claim.confidenceScore < 0.5 && getObservedSongCount(claim) <= 1 && claim.evidenceCount <= 1) {
        return {
          decision: "rejected" as LafzBrainPromotionDecision,
          reason: "Artist entity role signal is too weak to trust."
        };
      }
      return {
        decision: "deferred" as LafzBrainPromotionDecision,
        reason: "Entity role needs repeated support before promotion."
      };

    case "artist_relationship_pattern_observation":
      if (
        isReusableArtistEntityClass(getClaimSourceEntityClass(claim)) &&
        isReusableArtistEntityClass(getClaimTargetEntityClass(claim)) &&
        claim.confidenceScore >= 0.74 &&
        getObservedSongCount(claim) >= 2 &&
        claim.evidenceCount >= 3
      ) {
        return {
          decision: "accepted" as LafzBrainPromotionDecision,
          reason: "Artist relationship pattern repeats strongly enough to trust."
        };
      }
      if (
        !isReusableArtistEntityClass(getClaimSourceEntityClass(claim)) ||
        !isReusableArtistEntityClass(getClaimTargetEntityClass(claim))
      ) {
        return {
          decision: "deferred" as LafzBrainPromotionDecision,
          reason: "Keep symbolic or abstract relationship patterns as observations until Lafz sees stronger repeated cross-song support."
        };
      }
      if (claim.confidenceScore < 0.52 && getObservedSongCount(claim) <= 1 && claim.evidenceCount <= 1) {
        return {
          decision: "rejected" as LafzBrainPromotionDecision,
          reason: "Artist relationship pattern is too weak or inconsistent to keep."
        };
      }
      return {
        decision: "deferred" as LafzBrainPromotionDecision,
        reason: "Relationship pattern needs more repeated support before acceptance."
      };

    case "artist_term_usage_observation":
      if (claim.confidenceScore >= 0.74 && claim.evidenceCount >= 2) {
        return {
          decision: "accepted" as LafzBrainPromotionDecision,
          reason: "Artist term usage is supported by memory plus draft evidence."
        };
      }
      if (claim.confidenceScore < 0.55 && claim.evidenceCount <= 1) {
        return {
          decision: "rejected" as LafzBrainPromotionDecision,
          reason: "Artist term usage is too weak to trust yet."
        };
      }
      return {
        decision: "deferred" as LafzBrainPromotionDecision,
        reason: "Needs repeated usage before promotion."
      };

    case "song_vocabulary_observation":
      if (claim.confidenceScore >= 0.74 && claim.evidenceCount >= 2) {
        return {
          decision: "accepted" as LafzBrainPromotionDecision,
          reason: "Discovered song vocabulary has strong extractor plus line evidence."
        };
      }
      if (claim.confidenceScore < 0.45) {
        return {
          decision: "rejected" as LafzBrainPromotionDecision,
          reason: "Discovered song vocabulary is too weak to trust."
        };
      }
      return {
        decision: "deferred" as LafzBrainPromotionDecision,
        reason: "Keep as a proposed vocabulary observation until it repeats."
      };
  }
}

async function runPhase2aPromotionFlow(claimIds: string[]) {
  const claims = await readBrainClaimsByIds(claimIds);

  if (claims.length === 0) {
    return {
      accepted: 0,
      rejected: 0,
      deferred: 0
    };
  }

  const existingPromotions = await listBrainPromotionsByClaimIds(claimIds);
  const latestByClaimId = getLatestPromotionByClaimId(existingPromotions);
  const counts = {
    accepted: 0,
    rejected: 0,
    deferred: 0
  };

  for (const claim of claims) {
    const decision = decidePromotionForClaim(claim);
    const existing = latestByClaimId.get(claim.id);

    if (existing?.decision === decision.decision) {
      counts[decision.decision] += 1;
      continue;
    }

    const promotion = await insertBrainPromotion({
      claimId: claim.id,
      decision: decision.decision,
      decidedBy: "phase2a_rule_engine",
      reason: decision.reason,
      payload: {
        softPromotion: true,
        claimType: claim.claimType,
        confidenceScore: claim.confidenceScore,
        evidenceCount: claim.evidenceCount
      }
    });

    if (promotion) {
      counts[decision.decision] += 1;
    }
  }

  return counts;
}

export async function recordVocabularyClaimsIntoLafzBrain(options: RecordDraftClaimsOptions) {
  const agentSessionId = randomUUID();

  try {
    const settledResults = await Promise.allSettled([
      recordArtistTermUsageClaims(options, agentSessionId),
      recordDiscoveredVocabularyClaims(options, agentSessionId)
    ]);
    const results = settledResults.flatMap((result) => {
      if (result.status === "fulfilled") {
        return [result.value];
      }

      console.error("[lafz-brain] vocabulary claim subtask failed.", result.reason);
      return [];
    });
    const merged = mergeClaimWriteResults(results);
    const promotionSummary = await runPhase2aPromotionFlow(Array.from(merged.touchedClaimIds));

    return {
      claimsUpserted: merged.claimsUpserted,
      evidencesInserted: merged.evidencesInserted,
      promotionsRecorded: promotionSummary.accepted + promotionSummary.deferred + promotionSummary.rejected,
      promotions: promotionSummary
    };
  } catch (error) {
    console.error("[lafz-brain] record vocabulary claims failed.", error);
    return {
      claimsUpserted: 0,
      evidencesInserted: 0,
      promotionsRecorded: 0,
      promotions: {
        accepted: 0,
        rejected: 0,
        deferred: 0
      }
    };
  }
}

export async function recordEntityClaimsIntoLafzBrain(options: RecordDraftClaimsOptions) {
  const agentSessionId = randomUUID();

  try {
    const results = await Promise.all([recordArtistEntityRoleClaims(options, agentSessionId)]);

    const merged = mergeClaimWriteResults(results);
    const promotionSummary = await runPhase2aPromotionFlow(Array.from(merged.touchedClaimIds));

    return {
      claimsUpserted: merged.claimsUpserted,
      evidencesInserted: merged.evidencesInserted,
      promotionsRecorded: promotionSummary.accepted + promotionSummary.deferred + promotionSummary.rejected,
      promotions: promotionSummary
    };
  } catch (error) {
    console.error("[lafz-brain] record entity claims failed.", error);
    return {
      claimsUpserted: 0,
      evidencesInserted: 0,
      promotionsRecorded: 0,
      promotions: {
        accepted: 0,
        rejected: 0,
        deferred: 0
      }
    };
  }
}

export async function recordMotifClaimsIntoLafzBrain(options: RecordDraftClaimsOptions) {
  const agentSessionId = randomUUID();

  try {
    const results = await Promise.all([recordArtistMotifPatternClaims(options, agentSessionId)]);
    const merged = mergeClaimWriteResults(results);
    const promotionSummary = await runPhase2aPromotionFlow(Array.from(merged.touchedClaimIds));

    return {
      claimsUpserted: merged.claimsUpserted,
      evidencesInserted: merged.evidencesInserted,
      promotionsRecorded: promotionSummary.accepted + promotionSummary.deferred + promotionSummary.rejected,
      promotions: promotionSummary
    };
  } catch (error) {
    console.error("[lafz-brain] record motif claims failed.", error);
    return {
      claimsUpserted: 0,
      evidencesInserted: 0,
      promotionsRecorded: 0,
      promotions: {
        accepted: 0,
        rejected: 0,
        deferred: 0
      }
    };
  }
}

export async function recordPersonaClaimsIntoLafzBrain(options: RecordDraftClaimsOptions) {
  const agentSessionId = randomUUID();

  try {
    const results = await Promise.all([recordArtistPersonaStyleClaims(options, agentSessionId)]);
    const merged = mergeClaimWriteResults(results);
    const promotionSummary = await runPhase2aPromotionFlow(Array.from(merged.touchedClaimIds));

    return {
      claimsUpserted: merged.claimsUpserted,
      evidencesInserted: merged.evidencesInserted,
      promotionsRecorded: promotionSummary.accepted + promotionSummary.deferred + promotionSummary.rejected,
      promotions: promotionSummary
    };
  } catch (error) {
    console.error("[lafz-brain] record persona claims failed.", error);
    return {
      claimsUpserted: 0,
      evidencesInserted: 0,
      promotionsRecorded: 0,
      promotions: {
        accepted: 0,
        rejected: 0,
        deferred: 0
      }
    };
  }
}

export async function recordDraftClaimsIntoLafzBrain(options: RecordDraftClaimsOptions) {
  const agentSessionId = randomUUID();

  try {
    const results = await Promise.all([
      recordSongMotifClaims(options, agentSessionId),
      recordSongSymbolClaims(options, agentSessionId),
      recordRelationshipClaims(options, agentSessionId)
    ]);

    const merged = mergeClaimWriteResults(results);
    const promotionSummary = await runPhase2aPromotionFlow(Array.from(merged.touchedClaimIds));

    return {
      claimsUpserted: merged.claimsUpserted,
      evidencesInserted: merged.evidencesInserted,
      promotionsRecorded: promotionSummary.accepted + promotionSummary.deferred + promotionSummary.rejected,
      promotions: promotionSummary
    };
  } catch (error) {
    console.error("[lafz-brain] record draft claims failed.", error);
    return {
      claimsUpserted: 0,
      evidencesInserted: 0,
      promotionsRecorded: 0,
      promotions: {
        accepted: 0,
        rejected: 0,
        deferred: 0
      }
    };
  }
}
