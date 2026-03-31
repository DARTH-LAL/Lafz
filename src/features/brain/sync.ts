import type { AiArtistMemory, AiCanonicalRendering, AiTranslationDraftFile } from "@/features/ai/types";
import type { AiGlossaryEntry } from "@/features/ai/glossary";
import { normalizeLookupText } from "@/features/ai/romanized-normalization";
import { buildSongTranslationMemoryPack } from "@/features/brain/memory-pack";
import {
  linkArtistProfileNode,
  upsertBrainEdge,
  upsertBrainNode,
  upsertSongWorldModel
} from "@/features/brain/repository";
import {
  buildEdgeKey,
  buildEntityInstanceKey,
  buildSongNodeKey,
  normalizeBrainKey,
  splitArtistCredits,
  uniqStrings
} from "@/features/brain/normalize";

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

  return uniqStrings([
    ...artistMemory.voiceNotes,
    ...artistMemory.stanceNotes,
    ...artistMemory.toneNotes,
    ...artistMemory.translationPreferences.slice(0, 2)
  ]).slice(0, 6);
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
    aliases: [artistName],
    description: artistMemory?.personaSummary ?? null,
    metadata: {
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
    }
  });

  if (artistNode && artistMemory?.artistKey === artistKey) {
    await linkArtistProfileNode(artistKey, artistNode.id);
  }

  return artistNode;
}

async function upsertMotifLinks(songNodeId: string, artistNodeIds: string[], motifs: string[], sourceSongId: string) {
  for (const motif of uniqStrings(motifs)) {
    const motifKey = normalizeBrainKey(motif);

    if (!motifKey) {
      continue;
    }

    const motifNode = await upsertBrainNode({
      nodeType: "motif",
      canonicalKey: motifKey,
      displayLabel: motif
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
      weight: 0.8
    });

    for (const artistNodeId of artistNodeIds) {
      await upsertBrainEdge({
        edgeKey: buildEdgeKey("artist_exhibits_motif", artistNodeId, motifNode.id),
        edgeType: "artist_exhibits_motif",
        sourceNodeId: artistNodeId,
        targetNodeId: motifNode.id,
        weight: 0.7
      });
    }
  }
}

async function upsertPersonaStyleLinks(artistNodeIds: string[], artistMemory: AiArtistMemory | null) {
  for (const personaStyle of buildPersonaStyleCandidates(artistMemory)) {
    const personaKey = normalizeBrainKey(personaStyle);

    if (!personaKey) {
      continue;
    }

    const personaNode = await upsertBrainNode({
      nodeType: "persona_style",
      canonicalKey: personaKey,
      displayLabel: personaStyle
    });

    if (!personaNode) {
      continue;
    }

    for (const artistNodeId of artistNodeIds) {
      await upsertBrainEdge({
        edgeKey: buildEdgeKey("artist_has_persona_style", artistNodeId, personaNode.id),
        edgeType: "artist_has_persona_style",
        sourceNodeId: artistNodeId,
        targetNodeId: personaNode.id,
        weight: 0.65
      });
    }
  }
}

async function upsertSymbolLinks(songNodeId: string, symbols: string[], sourceSongId: string) {
  for (const symbol of uniqStrings(symbols)) {
    const symbolKey = normalizeBrainKey(symbol);

    if (!symbolKey) {
      continue;
    }

    const symbolNode = await upsertBrainNode({
      nodeType: "symbol",
      canonicalKey: symbolKey,
      displayLabel: symbol
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
      weight: 0.75
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
      aliases: entity.aliases,
      description: entity.description,
      metadata: {
        entityKey: entity.entityKey,
        role: entity.role,
        salience: entity.salience,
        spotifyTrackId: draftFile.spotifyTrackId
      }
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
      weight: confidenceToWeight(entity.salience)
    });

    const entityTypeKey = normalizeBrainKey(entity.role);

    if (!entityTypeKey) {
      continue;
    }

    const entityTypeNode = await upsertBrainNode({
      nodeType: "entity_type",
      canonicalKey: entityTypeKey,
      displayLabel: entity.role ?? entity.label
    });

    if (!entityTypeNode) {
      continue;
    }

    await upsertBrainEdge({
      edgeKey: buildEdgeKey("entity_instance_is_type", instanceNode.id, entityTypeNode.id),
      edgeType: "entity_instance_is_type",
      sourceNodeId: instanceNode.id,
      targetNodeId: entityTypeNode.id,
      weight: 0.9
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
        confidence: relationship.confidence
      },
      evidence: relationship.evidence ?? null
    });
  }
}

async function upsertTermLinks(
  artistNodeIds: string[],
  songNodeId: string,
  sourceSongId: string,
  sourceLanguage: string | null,
  glossaryEntries: AiGlossaryEntry[],
  canonicalRenderings: AiCanonicalRendering[],
  lyricTexts: string[]
) {
  const combinedEntries = [
    ...glossaryEntries,
    ...canonicalRenderings.map((entry) => ({
      term: entry.term,
      meaning: entry.rendering,
      note: entry.note,
      aliases: [] as string[],
      category: "preferred_rendering" as const
    }))
  ];

  for (const entry of combinedEntries) {
    const termKey = normalizeBrainKey(entry.term);
    const meaningKey = normalizeBrainKey(entry.meaning);

    if (!termKey || !meaningKey) {
      continue;
    }

    const termNode = await upsertBrainNode({
      nodeType: "term_surface",
      canonicalKey: termKey,
      displayLabel: entry.term,
      aliases: entry.aliases ?? [],
      languageCode: sourceLanguage,
      description: entry.note ?? null,
      metadata: {
        category: entry.category ?? "entry"
      }
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
      metadata: {
        term: entry.term,
        meaning: entry.meaning,
        note: entry.note ?? null
      }
    });

    const renderingNode = await upsertBrainNode({
      nodeType: "rendering",
      canonicalKey: buildRenderingKey(entry.meaning),
      displayLabel: entry.meaning,
      description: entry.note ?? null
    });

    if (!senseNode || !renderingNode) {
      continue;
    }

    await upsertBrainEdge({
      edgeKey: buildEdgeKey("term_surface_maps_to_term_sense", termNode.id, senseNode.id),
      edgeType: "term_surface_maps_to_term_sense",
      sourceNodeId: termNode.id,
      targetNodeId: senseNode.id,
      weight: 0.8,
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
      weight: 0.9,
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
        weight: 0.7,
        metadata: {
          category: entry.category ?? "entry"
        }
      });

      await upsertBrainEdge({
        edgeKey: buildEdgeKey("artist_prefers_rendering", artistNodeId, renderingNode.id),
        edgeType: "artist_prefers_rendering",
        sourceNodeId: artistNodeId,
        targetNodeId: renderingNode.id,
        weight: 0.72,
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
        weight: 0.75,
        metadata: {
          category: entry.category ?? "entry"
        }
      });
    }
  }
}

export async function syncDraftIntoLafzBrain(draftFile: AiTranslationDraftFile) {
  const songNode = await upsertBrainNode({
    nodeType: "song",
    canonicalKey: buildSongNodeKey(draftFile.spotifyTrackId),
    displayLabel: draftFile.title,
    aliases: [draftFile.title],
    languageCode: draftFile.sourceLanguage,
    description: draftFile.songContext?.summary ?? draftFile.worldModel?.summary ?? null,
    metadata: {
      spotifyTrackId: draftFile.spotifyTrackId,
      title: draftFile.title,
      artist: draftFile.artist,
      album: draftFile.album,
      sourceLanguage: draftFile.sourceLanguage,
      targetLanguage: draftFile.targetLanguage,
      generatedAt: draftFile.generatedAt
    }
  });

  if (!songNode) {
    return;
  }

  const artistCredits = splitArtistCredits(draftFile.artist);
  const primaryArtistKey = draftFile.artistMemory?.artistKey ?? artistCredits[0]?.key ?? null;
  const artistNodes = await Promise.all(
    artistCredits.map((credit) =>
      upsertArtistNode(
        credit.name,
        primaryArtistKey === credit.key ? draftFile.artistMemory : null
      )
    )
  );
  const hydratedArtistNodes = artistNodes.filter((node): node is NonNullable<typeof node> => Boolean(node));

  for (const artistNode of hydratedArtistNodes) {
    await upsertBrainEdge({
      edgeKey: buildEdgeKey("artist_recorded_song", artistNode.id, songNode.id),
      edgeType: "artist_recorded_song",
      sourceNodeId: artistNode.id,
      targetNodeId: songNode.id,
      weight: 0.95
    });
  }

  await upsertPersonaStyleLinks(
    hydratedArtistNodes.map((node) => node.id),
    draftFile.artistMemory
  );

  const motifs = uniqStrings([
    ...(draftFile.songContext?.themes ?? []),
    ...(draftFile.worldModel?.coreMotifs ?? []),
    ...(draftFile.artistMemory?.recurringMotifs ?? [])
  ]);

  await upsertMotifLinks(songNode.id, hydratedArtistNodes.map((node) => node.id), motifs, songNode.id);
  await upsertSymbolLinks(songNode.id, draftFile.worldModel?.recurringSymbols ?? [], songNode.id);
  await upsertEntityLinks(draftFile, songNode.id, songNode.id);
  await upsertTermLinks(
    hydratedArtistNodes.map((node) => node.id),
    songNode.id,
    songNode.id,
    draftFile.sourceLanguage,
    draftFile.artistMemory?.glossaryEntries ?? [],
    draftFile.artistMemory?.canonicalRenderings ?? [],
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

  await buildSongTranslationMemoryPack({
    spotifyTrackId: draftFile.spotifyTrackId,
    artist: draftFile.artist,
    candidateTexts: draftFile.lines.slice(0, 24).map((line) => line.original),
    forceRefresh: true
  });
}
