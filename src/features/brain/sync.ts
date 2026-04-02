import type { AiArtistMemory, AiCanonicalRendering, AiTranslationDraftFile } from "@/features/ai/types";
import type { AiGlossaryEntry } from "@/features/ai/glossary";
import { getAiArtistMemory } from "@/features/ai/artist-memory";
import { normalizeLookupText } from "@/features/ai/romanized-normalization";
import { enqueueVocabularyAgentJob } from "@/features/brain/agent-jobs";
import { recordDraftClaimsIntoLafzBrain } from "@/features/brain/claims";
import { buildSongTranslationMemoryPack } from "@/features/brain/memory-pack";
import {
  linkArtistProfileNode,
  upsertBrainEdge,
  upsertBrainNode,
  upsertSongWorldModel
} from "@/features/brain/repository";
import {
  buildBrainAliases,
  buildEdgeKey,
  buildEntityInstanceKey,
  buildSongNodeKey,
  canonicalizeBrainMotif,
  canonicalizePersonaStyle,
  isDirectiveLikePersonaStyleText,
  isGenericSingleTokenPersonaStyle,
  isSentenceLikePersonaStyleText,
  normalizeBrainKey,
  splitArtistCredits,
  uniqStrings
} from "@/features/brain/normalize";
import { applyPolicyWeight, evaluateBrainNodePolicy, summarizePolicy } from "@/features/brain/policy";

type HydratedArtistSyncContext = {
  name: string;
  artistKey: string;
  memory: AiArtistMemory | null;
  nodeId: string;
};

function confidenceToWeight(confidence: "low" | "medium" | "high" | null | undefined) {
  switch (confidence) {
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

function buildPersonaStyleCandidates(artistMemory: AiArtistMemory | null) {
  if (!artistMemory) {
    return [] as string[];
  }

  const rawCandidates = uniqStrings([
    ...artistMemory.voiceNotes,
    ...artistMemory.stanceNotes,
    ...artistMemory.toneNotes
  ]);

  const canonicalCandidates = rawCandidates.flatMap((value) => {
    if (isDirectiveLikePersonaStyleText(value) || isGenericSingleTokenPersonaStyle(value)) {
      return [];
    }

    const canonical = canonicalizePersonaStyle(value);

    if (!canonical && isSentenceLikePersonaStyleText(value)) {
      return [];
    }

    return [canonical?.displayLabel ?? value];
  });

  return uniqStrings(canonicalCandidates).slice(0, 6);
}

function withPolicyMetadata<T extends Record<string, unknown>>(nodeType: Parameters<typeof evaluateBrainNodePolicy>[0], label: string, metadata?: T) {
  const policy = evaluateBrainNodePolicy(nodeType, label);

  return {
    ...(metadata ?? {}),
    policy: summarizePolicy(policy)
  };
}

async function upsertArtistNode(artistName: string, artistMemory: AiArtistMemory | null) {
  const artistKey = normalizeBrainKey(artistName);

  if (!artistKey) {
    return null;
  }

  const artistNode = await upsertBrainNode({
    nodeType: "artist",
    canonicalKey: artistKey,
    displayLabel: artistName,
    aliases: buildBrainAliases([artistName, artistMemory?.displayName]),
    description: artistMemory?.personaSummary ?? null,
    metadata: withPolicyMetadata("artist", artistName, {
      artistKey,
      displayName: artistMemory?.displayName ?? artistName,
      personaSummary: artistMemory?.personaSummary ?? null,
      translationPreferences: artistMemory?.translationPreferences ?? [],
      translationDirectives: artistMemory?.translationDirectives ?? [],
      recurringThemes: artistMemory?.recurringThemes ?? [],
      recurringMotifs: artistMemory?.recurringMotifs ?? [],
      relationshipPatterns: artistMemory?.relationshipPatterns ?? [],
      toneNotes: artistMemory?.toneNotes ?? [],
      voiceNotes: artistMemory?.voiceNotes ?? [],
      stanceNotes: artistMemory?.stanceNotes ?? [],
      perspectiveNotes: artistMemory?.perspectiveNotes ?? [],
      canonicalRenderings: artistMemory?.canonicalRenderings ?? []
    })
  });

  if (artistNode && artistMemory?.artistKey === artistKey) {
    await linkArtistProfileNode(artistKey, artistNode.id);
  }

  return artistNode;
}

async function upsertMotifLinks(
  songNodeId: string,
  motifs: string[],
  sourceSongId: string
) {
  for (const motif of uniqStrings(motifs)) {
    const canonicalMotif = canonicalizeBrainMotif(motif);
    const motifKey = canonicalMotif?.canonicalKey ?? null;
    const motifLabel = canonicalMotif?.displayLabel ?? motif;
    const policy = evaluateBrainNodePolicy("motif", motifLabel);

    if (!motifKey || policy.scope === "song_local" || !policy.shouldInject) {
      continue;
    }

    const motifNode = await upsertBrainNode({
      nodeType: "motif",
      canonicalKey: motifKey,
      displayLabel: motifLabel,
      aliases: buildBrainAliases([motifLabel, canonicalMotif?.sourceLabel]),
      metadata: withPolicyMetadata("motif", motifLabel, {
        sourceLabels: uniqStrings([canonicalMotif?.sourceLabel])
      })
    });

    if (!motifNode) {
      continue;
    }

    await upsertBrainEdge({
      edgeKey: buildEdgeKey("song_has_motif", songNodeId, motifNode.id, sourceSongId),
      edgeType: "song_has_motif",
      sourceNodeId: songNodeId,
      targetNodeId: motifNode.id,
      sourceSongId,
      weight: applyPolicyWeight(0.8, policy),
      metadata: {
        policy: summarizePolicy(policy)
      }
    });
  }
}

async function upsertPersonaStyleLinks(artistNodeId: string, artistMemory: AiArtistMemory | null) {
  for (const personaStyle of buildPersonaStyleCandidates(artistMemory)) {
    const personaKey = normalizeBrainKey(personaStyle);
    const policy = evaluateBrainNodePolicy("persona_style", personaStyle);

    if (!personaKey || !policy.shouldInject) {
      continue;
    }

    const personaNode = await upsertBrainNode({
      nodeType: "persona_style",
      canonicalKey: personaKey,
      displayLabel: personaStyle,
      metadata: withPolicyMetadata("persona_style", personaStyle)
    });

    if (!personaNode) {
      continue;
    }

    await upsertBrainEdge({
      edgeKey: buildEdgeKey("artist_has_persona_style", artistNodeId, personaNode.id),
      edgeType: "artist_has_persona_style",
      sourceNodeId: artistNodeId,
      targetNodeId: personaNode.id,
      weight: applyPolicyWeight(0.65, policy),
      metadata: {
        policy: summarizePolicy(policy)
      }
    });
  }
}

async function upsertSymbolLinks(songNodeId: string, symbols: string[], sourceSongId: string) {
  for (const symbol of uniqStrings(symbols)) {
    const symbolKey = normalizeBrainKey(symbol);
    const policy = evaluateBrainNodePolicy("symbol", symbol);

    if (!symbolKey || policy.scope === "song_local" || !policy.shouldInject) {
      continue;
    }

    const symbolNode = await upsertBrainNode({
      nodeType: "symbol",
      canonicalKey: symbolKey,
      displayLabel: symbol,
      metadata: withPolicyMetadata("symbol", symbol)
    });

    if (!symbolNode) {
      continue;
    }

    await upsertBrainEdge({
      edgeKey: buildEdgeKey("song_uses_symbol", songNodeId, symbolNode.id, sourceSongId),
      edgeType: "song_uses_symbol",
      sourceNodeId: songNodeId,
      targetNodeId: symbolNode.id,
      sourceSongId,
      weight: applyPolicyWeight(0.75, policy),
      metadata: {
        policy: summarizePolicy(policy)
      }
    });
  }
}

async function upsertEntityLinks(draftFile: AiTranslationDraftFile, songNodeId: string, sourceSongId: string) {
  const worldModel = draftFile.worldModel;

  if (!worldModel) {
    return;
  }

  const entityNodeIds = new Map<string, string>();

  for (const entity of worldModel.entities) {
    const instanceKey = buildEntityInstanceKey(draftFile.spotifyTrackId, entity.entityKey);
    const instanceNode = await upsertBrainNode({
      nodeType: "entity_instance",
      canonicalKey: instanceKey,
      displayLabel: entity.label,
      aliases: buildBrainAliases([entity.label, ...entity.aliases]),
      description: entity.description,
      metadata: withPolicyMetadata("entity_instance", entity.label, {
        entityKey: entity.entityKey,
        role: entity.role,
        salience: entity.salience,
        spotifyTrackId: draftFile.spotifyTrackId
      })
    });

    if (!instanceNode) {
      continue;
    }

    entityNodeIds.set(entity.entityKey, instanceNode.id);

    await upsertBrainEdge({
      edgeKey: buildEdgeKey("song_contains_entity_instance", songNodeId, instanceNode.id, sourceSongId),
      edgeType: "song_contains_entity_instance",
      sourceNodeId: songNodeId,
      targetNodeId: instanceNode.id,
      sourceSongId,
      weight: confidenceToWeight(entity.salience),
      metadata: {
        scope: "song_local"
      }
    });

    const entityTypeKey = normalizeBrainKey(entity.role);

    if (!entityTypeKey) {
      continue;
    }

    const entityTypeNode = await upsertBrainNode({
      nodeType: "entity_type",
      canonicalKey: entityTypeKey,
      displayLabel: entity.role ?? entity.label,
      metadata: withPolicyMetadata("entity_type", entity.role ?? entity.label)
    });

    if (!entityTypeNode) {
      continue;
    }

    await upsertBrainEdge({
      edgeKey: buildEdgeKey("entity_instance_is_type", instanceNode.id, entityTypeNode.id),
      edgeType: "entity_instance_is_type",
      sourceNodeId: instanceNode.id,
      targetNodeId: entityTypeNode.id,
      weight: 0.9,
      metadata: {
        scope: "song_local"
      }
    });
  }

  for (const relationship of worldModel.relationshipGraph) {
    const sourceNodeId = entityNodeIds.get(relationship.sourceEntity);
    const targetNodeId = entityNodeIds.get(relationship.targetEntity);

    if (!sourceNodeId || !targetNodeId) {
      continue;
    }

    await upsertBrainEdge({
      edgeKey: buildEdgeKey("entity_instance_related_to_entity_instance", sourceNodeId, targetNodeId, sourceSongId),
      edgeType: "entity_instance_related_to_entity_instance",
      sourceNodeId,
      targetNodeId,
      sourceSongId,
      weight: confidenceToWeight(relationship.confidence),
      metadata: {
        dynamic: relationship.dynamic,
        powerBalance: relationship.powerBalance,
        evidence: relationship.evidence,
        confidence: relationship.confidence,
        scope: "song_local"
      },
      evidence: relationship.evidence ?? null
    });
  }
}

async function upsertTermLinks(
  artists: HydratedArtistSyncContext[],
  songNodeId: string,
  sourceSongId: string,
  sourceLanguage: string | null,
  lyricTexts: string[]
) {
  const combinedEntries = new Map<
    string,
    {
      entry: AiGlossaryEntry;
      artistNodeIds: Set<string>;
    }
  >();

  for (const artist of artists) {
    const artistEntries = [
      ...(artist.memory?.glossaryEntries ?? []),
      ...((artist.memory?.canonicalRenderings ?? []) as AiCanonicalRendering[]).map((entry) => ({
        term: entry.term,
        meaning: entry.rendering,
        note: entry.note,
        aliases: [] as string[],
        category: "preferred_rendering" as const
      }))
    ];

    for (const entry of artistEntries) {
      const key = [
        normalizeBrainKey(entry.term) ?? entry.term.trim().toLowerCase(),
        normalizeBrainKey(entry.meaning) ?? entry.meaning.trim().toLowerCase(),
        entry.category ?? "entry"
      ].join("::");
      const existing = combinedEntries.get(key) ?? {
        entry,
        artistNodeIds: new Set<string>()
      };
      existing.artistNodeIds.add(artist.nodeId);
      if (!existing.entry.note && entry.note) {
        existing.entry = {
          ...existing.entry,
          note: entry.note
        };
      }
      if ((!existing.entry.aliases || existing.entry.aliases.length === 0) && Array.isArray(entry.aliases) && entry.aliases.length > 0) {
        existing.entry = {
          ...existing.entry,
          aliases: entry.aliases
        };
      }
      combinedEntries.set(key, existing);
    }
  }

  for (const { entry, artistNodeIds } of combinedEntries.values()) {
    const termKey = normalizeBrainKey(entry.term);
    const meaningKey = normalizeBrainKey(entry.meaning);

    if (!termKey || !meaningKey) {
      continue;
    }

    const termNode = await upsertBrainNode({
      nodeType: "term_surface",
      canonicalKey: termKey,
      displayLabel: entry.term,
      aliases: buildBrainAliases([entry.term, ...(entry.aliases ?? [])]),
      languageCode: sourceLanguage,
      description: entry.note ?? null,
      metadata: withPolicyMetadata("term_surface", entry.term, {
        category: entry.category ?? "entry"
      })
    });

    if (!termNode) {
      continue;
    }

    const senseNode = await upsertBrainNode({
      nodeType: "term_sense",
      canonicalKey: buildTermSenseKey(sourceLanguage, entry.term, entry.meaning),
      displayLabel: `${entry.term} -> ${entry.meaning}`,
      languageCode: sourceLanguage,
      description: entry.note ?? entry.meaning,
      metadata: withPolicyMetadata("term_sense", `${entry.term} ${entry.meaning}`, {
        term: entry.term,
        meaning: entry.meaning,
        note: entry.note ?? null
      })
    });

    const renderingNode = await upsertBrainNode({
      nodeType: "rendering",
      canonicalKey: buildRenderingKey(entry.meaning),
      displayLabel: entry.meaning,
      description: entry.note ?? null,
      metadata: withPolicyMetadata("rendering", entry.meaning)
    });

    if (!senseNode || !renderingNode) {
      continue;
    }

    await upsertBrainEdge({
      edgeKey: buildEdgeKey("term_surface_maps_to_term_sense", termNode.id, senseNode.id),
      edgeType: "term_surface_maps_to_term_sense",
      sourceNodeId: termNode.id,
      targetNodeId: senseNode.id,
      weight: entry.category === "preferred_rendering" ? 0.88 : 0.8,
      metadata: {
        note: entry.note ?? null,
        category: entry.category ?? "entry"
      }
    });

    await upsertBrainEdge({
      edgeKey: buildEdgeKey("term_sense_prefers_rendering", senseNode.id, renderingNode.id),
      edgeType: "term_sense_prefers_rendering",
      sourceNodeId: senseNode.id,
      targetNodeId: renderingNode.id,
      weight: entry.category === "preferred_rendering" ? 0.95 : 0.84,
      metadata: {
        note: entry.note ?? null
      }
    });

    for (const artistNodeId of artistNodeIds) {
      await upsertBrainEdge({
        edgeKey: buildEdgeKey("artist_uses_term_surface", artistNodeId, termNode.id),
        edgeType: "artist_uses_term_surface",
        sourceNodeId: artistNodeId,
        targetNodeId: termNode.id,
        weight: termUsedInSong(entry.term, entry.aliases ?? [], lyricTexts) ? 0.76 : 0.58,
        metadata: {
          category: entry.category ?? "entry"
        }
      });

      await upsertBrainEdge({
        edgeKey: buildEdgeKey("artist_prefers_rendering", artistNodeId, renderingNode.id),
        edgeType: "artist_prefers_rendering",
        sourceNodeId: artistNodeId,
        targetNodeId: renderingNode.id,
        weight: entry.category === "preferred_rendering" ? 0.88 : 0.68,
        metadata: {
          term: entry.term,
          note: entry.note ?? null
        }
      });
    }

    if (termUsedInSong(entry.term, entry.aliases ?? [], lyricTexts)) {
      await upsertBrainEdge({
        edgeKey: buildEdgeKey("song_uses_term_surface", songNodeId, termNode.id, sourceSongId),
        edgeType: "song_uses_term_surface",
        sourceNodeId: songNodeId,
        targetNodeId: termNode.id,
        sourceSongId,
        weight: 0.86,
        metadata: {
          category: entry.category ?? "entry"
        }
      });
    }
  }
}

async function resolveArtistMemoryForCredit(
  credit: { name: string; key: string },
  primaryArtistKey: string | null,
  primaryArtistMemory: AiArtistMemory | null
) {
  if (primaryArtistKey === credit.key) {
    return primaryArtistMemory;
  }

  try {
    const { memory } = await getAiArtistMemory(credit.name);
    return memory?.artistKey === credit.key ? memory : null;
  } catch {
    return null;
  }
}

export async function syncDraftIntoLafzBrain(draftFile: AiTranslationDraftFile) {
  const songNode = await upsertBrainNode({
    nodeType: "song",
    canonicalKey: buildSongNodeKey(draftFile.spotifyTrackId),
    displayLabel: draftFile.title,
    aliases: buildBrainAliases([draftFile.title]),
    languageCode: draftFile.sourceLanguage,
    description: draftFile.songContext?.summary ?? draftFile.worldModel?.summary ?? null,
    metadata: withPolicyMetadata("song", draftFile.title, {
      spotifyTrackId: draftFile.spotifyTrackId,
      title: draftFile.title,
      artist: draftFile.artist,
      album: draftFile.album,
      sourceLanguage: draftFile.sourceLanguage,
      targetLanguage: draftFile.targetLanguage,
      generatedAt: draftFile.generatedAt
    })
  });

  if (!songNode) {
    return;
  }

  const artistCredits = splitArtistCredits(draftFile.artist);
  const primaryArtistKey = draftFile.artistMemory?.artistKey ?? artistCredits[0]?.key ?? null;
  const hydratedArtists = (
    await Promise.all(
      artistCredits.map(async (credit) => {
        const artistMemory = await resolveArtistMemoryForCredit(credit, primaryArtistKey, draftFile.artistMemory);
        const artistNode = await upsertArtistNode(credit.name, artistMemory);

        if (!artistNode) {
          return null;
        }

        return {
          name: credit.name,
          artistKey: credit.key,
          memory: artistMemory,
          nodeId: artistNode.id
        } satisfies HydratedArtistSyncContext;
      })
    )
  ).filter((artist): artist is HydratedArtistSyncContext => Boolean(artist));

  for (const artist of hydratedArtists) {
    await upsertBrainEdge({
      edgeKey: buildEdgeKey("artist_recorded_song", artist.nodeId, songNode.id),
      edgeType: "artist_recorded_song",
      sourceNodeId: artist.nodeId,
      targetNodeId: songNode.id,
      weight: 0.95
    });
  }

  const primaryHydratedArtist = hydratedArtists[0] ?? null;

  if (primaryHydratedArtist) {
    await upsertPersonaStyleLinks(primaryHydratedArtist.nodeId, primaryHydratedArtist.memory);
  }

  const motifs = uniqStrings([
    ...(draftFile.songContext?.themes ?? []),
    ...(draftFile.worldModel?.coreMotifs ?? []),
    ...(draftFile.artistMemory?.recurringMotifs ?? [])
  ]);

  await upsertMotifLinks(songNode.id, motifs, songNode.id);
  await upsertSymbolLinks(songNode.id, draftFile.worldModel?.recurringSymbols ?? [], songNode.id);
  await upsertEntityLinks(draftFile, songNode.id, songNode.id);
  await upsertTermLinks(
    hydratedArtists,
    songNode.id,
    songNode.id,
    draftFile.sourceLanguage,
    draftFile.lines.map((line) => line.original)
  );

  await upsertSongWorldModel({
    songNodeId: songNode.id,
    spotifyTrackId: draftFile.spotifyTrackId,
    title: draftFile.title,
    artist: draftFile.artist,
    artistKeys: artistCredits.map((credit) => credit.key),
    sourceLanguage: draftFile.sourceLanguage,
    summary: draftFile.worldModel?.summary ?? draftFile.songContext?.summary ?? null,
    speakerPersona: draftFile.worldModel?.speakerPersona ?? null,
    addressee: draftFile.worldModel?.addressee ?? draftFile.songContext?.addressee ?? null,
    narrativeDrive: draftFile.worldModel?.narrativeDrive ?? null,
    dominantConflict: draftFile.worldModel?.dominantConflict ?? null,
    worldState: draftFile.worldModel?.worldState ?? null,
    coreMotifs: draftFile.worldModel?.coreMotifs ?? draftFile.songContext?.themes ?? [],
    recurringSymbols: draftFile.worldModel?.recurringSymbols ?? [],
    continuityRules: draftFile.worldModel?.continuityRules ?? [],
    entitiesJson: draftFile.worldModel?.entities ?? [],
    relationshipsJson: draftFile.worldModel?.relationshipGraph ?? [],
    verseModelsJson: draftFile.worldModel?.verseModels ?? [],
    lineModelsJson: draftFile.worldModel?.lineModels ?? [],
    modelId: draftFile.generator.model,
    generatedAt: draftFile.generatedAt
  });

  void recordDraftClaimsIntoLafzBrain({
    draftFile,
    songNodeId: songNode.id,
    artists: hydratedArtists.map((artist) => ({
      artistKey: artist.artistKey,
      displayName: artist.name,
      memory: artist.memory
    }))
  });

  await buildSongTranslationMemoryPack({
    spotifyTrackId: draftFile.spotifyTrackId,
    artist: draftFile.artist,
    candidateTexts: draftFile.lines.slice(0, 24).map((line) => line.original),
    forceRefresh: true
  });

  void enqueueVocabularyAgentJob({
    draftFile,
    songNodeId: songNode.id
  }).catch(() => {
    // Non-fatal queue side effect.
  });
}
