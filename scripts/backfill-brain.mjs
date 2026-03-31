import { createClient } from "@supabase/supabase-js";

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.map((entry) => asString(entry)).filter((entry) => Boolean(entry))
    : [];
}

function normalizeKey(value) {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : null;
}

function normalizeText(value) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

function normalizeLookupText(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function splitArtistCredits(artist) {
  if (!artist) {
    return [];
  }

  return artist
    .split(/,|&| feat\.? | ft\.? | x /i)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((name) => ({ name, key: normalizeKey(name) }))
    .filter((entry) => entry.key);
}

function uniqStrings(values) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean)));
}

function buildSongNodeKey(spotifyTrackId) {
  return spotifyTrackId.trim();
}

function buildEntityInstanceKey(spotifyTrackId, entityKey) {
  return `${spotifyTrackId}:${String(entityKey).trim().toLowerCase()}`;
}

function buildEdgeKey(edgeType, sourceNodeId, targetNodeId, sourceSongId) {
  return [edgeType, sourceNodeId, targetNodeId, sourceSongId ?? "global"].join("::");
}

function buildTermSenseKey(languageCode, term, meaning) {
  return [languageCode ?? "any", normalizeKey(term) ?? term, normalizeKey(meaning) ?? meaning].join("::");
}

function buildRenderingKey(meaning) {
  return normalizeKey(meaning) ?? meaning.trim().toLowerCase();
}

function buildMemoryPackCacheKey(artistKeys, spotifyTrackId) {
  return `translation:${[...artistKeys].sort().join(",")}:${spotifyTrackId}`;
}

function confidenceToWeight(confidence) {
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

async function fetchAllRows(queryFactory, batchSize = 500) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + batchSize - 1;
    const { data, error } = await queryFactory(from, to);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    rows.push(...data);

    if (data.length < batchSize) {
      break;
    }

    from += batchSize;
  }

  return rows;
}

function createNodeStore() {
  const nodes = new Map();

  return {
    async upsert(supabase, input) {
      const cacheKey = `${input.nodeType}::${input.canonicalKey}`;

      if (nodes.has(cacheKey)) {
        return nodes.get(cacheKey);
      }

      const { data, error } = await supabase
        .from("kg_nodes")
        .upsert(
          {
            node_type: input.nodeType,
            canonical_key: input.canonicalKey,
            display_label: input.displayLabel,
            aliases: input.aliases ?? [],
            language_code: input.languageCode ?? null,
            description: input.description ?? null,
            metadata: input.metadata ?? {},
            source_confidence: input.sourceConfidence ?? "ai_generated",
            is_active: true,
            updated_at: new Date().toISOString()
          },
          { onConflict: "node_type,canonical_key" }
        )
        .select("id,node_type,canonical_key,display_label")
        .single();

      if (error) {
        throw error;
      }

      nodes.set(cacheKey, data);
      return data;
    },
    getByCacheKey(cacheKey) {
      return nodes.get(cacheKey) ?? null;
    }
  };
}

async function upsertEdge(supabase, input) {
  const { error } = await supabase.from("kg_edges").upsert(
    {
      edge_key: input.edgeKey,
      edge_type: input.edgeType,
      source_node_id: input.sourceNodeId,
      target_node_id: input.targetNodeId,
      weight: input.weight ?? 0.5,
      metadata: input.metadata ?? {},
      source_song_id: input.sourceSongId ?? null,
      evidence: input.evidence ?? null,
      is_active: true,
      updated_at: new Date().toISOString()
    },
    { onConflict: "edge_key" }
  );

  if (error) {
    throw error;
  }
}

async function upsertSongWorldModel(supabase, input) {
  const { error } = await supabase.from("song_world_models").upsert(
    {
      song_node_id: input.songNodeId,
      spotify_track_id: input.spotifyTrackId,
      title: input.title,
      artist: input.artist,
      artist_keys: input.artistKeys,
      source_language: input.sourceLanguage,
      summary: input.summary,
      speaker_persona: input.speakerPersona,
      addressee: input.addressee,
      narrative_drive: input.narrativeDrive,
      dominant_conflict: input.dominantConflict,
      world_state: input.worldState,
      core_motifs: input.coreMotifs,
      recurring_symbols: input.recurringSymbols,
      continuity_rules: input.continuityRules,
      entities_json: input.entitiesJson,
      relationships_json: input.relationshipsJson,
      verse_models_json: input.verseModelsJson,
      line_models_json: input.lineModelsJson,
      model_id: input.modelId,
      generated_at: input.generatedAt,
      updated_at: new Date().toISOString()
    },
    { onConflict: "spotify_track_id" }
  );

  if (error) {
    throw error;
  }
}

function termUsedInSong(term, aliases, lyricTexts) {
  const searchTerms = [term, ...(aliases ?? [])].map((value) => normalizeLookupText(value)).filter(Boolean);
  const haystack = lyricTexts.map((value) => normalizeLookupText(value)).filter(Boolean);
  return searchTerms.some((searchTerm) => haystack.some((line) => line.includes(searchTerm)));
}

async function upsertArtistNode(supabase, nodeStore, artistName, artistMemory) {
  const artistKey = normalizeKey(artistName);

  if (!artistKey) {
    return null;
  }

  const artistNode = await nodeStore.upsert(supabase, {
    nodeType: "artist",
    canonicalKey: artistKey,
    displayLabel: artistName,
    aliases: [artistName],
    description: asString(artistMemory?.personaSummary),
    metadata: {
      artistKey,
      displayName: asString(artistMemory?.displayName) ?? artistName,
      personaSummary: asString(artistMemory?.personaSummary),
      translationPreferences: asStringArray(artistMemory?.translationPreferences),
      translationDirectives: asStringArray(artistMemory?.translationDirectives),
      recurringThemes: asStringArray(artistMemory?.recurringThemes),
      recurringMotifs: asStringArray(artistMemory?.recurringMotifs),
      relationshipPatterns: asStringArray(artistMemory?.relationshipPatterns),
      toneNotes: asStringArray(artistMemory?.toneNotes),
      voiceNotes: asStringArray(artistMemory?.voiceNotes),
      stanceNotes: asStringArray(artistMemory?.stanceNotes),
      perspectiveNotes: asStringArray(artistMemory?.perspectiveNotes),
      canonicalRenderings: Array.isArray(artistMemory?.canonicalRenderings) ? artistMemory.canonicalRenderings : []
    }
  });

  if (artistNode && artistMemory?.artistKey === artistKey) {
    await supabase.from("artist_profiles").update({ kg_node_id: artistNode.id }).eq("artist_key", artistKey);
  }

  return artistNode;
}

function buildPersonaStyleCandidates(artistMemory) {
  if (!isRecord(artistMemory)) {
    return [];
  }

  return uniqStrings([
    ...asStringArray(artistMemory.voiceNotes),
    ...asStringArray(artistMemory.stanceNotes),
    ...asStringArray(artistMemory.toneNotes),
    ...asStringArray(artistMemory.translationPreferences).slice(0, 2)
  ]).slice(0, 6);
}

async function upsertPersonaStyleLinks(supabase, nodeStore, artistNodeIds, artistMemory) {
  for (const personaStyle of buildPersonaStyleCandidates(artistMemory)) {
    const personaKey = normalizeKey(personaStyle);

    if (!personaKey) {
      continue;
    }

    const personaNode = await nodeStore.upsert(supabase, {
      nodeType: "persona_style",
      canonicalKey: personaKey,
      displayLabel: personaStyle
    });

    for (const artistNodeId of artistNodeIds) {
      await upsertEdge(supabase, {
        edgeKey: buildEdgeKey("artist_has_persona_style", artistNodeId, personaNode.id),
        edgeType: "artist_has_persona_style",
        sourceNodeId: artistNodeId,
        targetNodeId: personaNode.id,
        weight: 0.65
      });
    }
  }
}

async function upsertMotifLinks(supabase, nodeStore, songNodeId, artistNodeIds, motifs, sourceSongId) {
  for (const motif of uniqStrings(motifs)) {
    const motifKey = normalizeKey(motif);

    if (!motifKey) {
      continue;
    }

    const motifNode = await nodeStore.upsert(supabase, {
      nodeType: "motif",
      canonicalKey: motifKey,
      displayLabel: motif
    });

    await upsertEdge(supabase, {
      edgeKey: buildEdgeKey("song_has_motif", songNodeId, motifNode.id, sourceSongId),
      edgeType: "song_has_motif",
      sourceNodeId: songNodeId,
      targetNodeId: motifNode.id,
      sourceSongId,
      weight: 0.8
    });

    for (const artistNodeId of artistNodeIds) {
      await upsertEdge(supabase, {
        edgeKey: buildEdgeKey("artist_exhibits_motif", artistNodeId, motifNode.id),
        edgeType: "artist_exhibits_motif",
        sourceNodeId: artistNodeId,
        targetNodeId: motifNode.id,
        weight: 0.7
      });
    }
  }
}

async function upsertSymbolLinks(supabase, nodeStore, songNodeId, symbols, sourceSongId) {
  for (const symbol of uniqStrings(symbols)) {
    const symbolKey = normalizeKey(symbol);

    if (!symbolKey) {
      continue;
    }

    const symbolNode = await nodeStore.upsert(supabase, {
      nodeType: "symbol",
      canonicalKey: symbolKey,
      displayLabel: symbol
    });

    await upsertEdge(supabase, {
      edgeKey: buildEdgeKey("song_uses_symbol", songNodeId, symbolNode.id, sourceSongId),
      edgeType: "song_uses_symbol",
      sourceNodeId: songNodeId,
      targetNodeId: symbolNode.id,
      sourceSongId,
      weight: 0.75
    });
  }
}

async function upsertEntityLinks(supabase, nodeStore, draft, songNodeId, sourceSongId) {
  const worldModel = isRecord(draft.worldModel) ? draft.worldModel : null;

  if (!worldModel || !Array.isArray(worldModel.entities)) {
    return;
  }

  const entityNodeIds = new Map();

  for (const entity of worldModel.entities) {
    if (!isRecord(entity)) {
      continue;
    }

    const entityKey = asString(entity.entityKey);
    const label = asString(entity.label);

    if (!entityKey || !label) {
      continue;
    }

    const instanceNode = await nodeStore.upsert(supabase, {
      nodeType: "entity_instance",
      canonicalKey: buildEntityInstanceKey(draft.spotifyTrackId, entityKey),
      displayLabel: label,
      aliases: asStringArray(entity.aliases),
      description: asString(entity.description),
      metadata: {
        entityKey,
        role: asString(entity.role),
        salience: asString(entity.salience),
        spotifyTrackId: draft.spotifyTrackId
      }
    });

    entityNodeIds.set(entityKey, instanceNode.id);

    await upsertEdge(supabase, {
      edgeKey: buildEdgeKey("song_contains_entity_instance", songNodeId, instanceNode.id, sourceSongId),
      edgeType: "song_contains_entity_instance",
      sourceNodeId: songNodeId,
      targetNodeId: instanceNode.id,
      sourceSongId,
      weight: confidenceToWeight(asString(entity.salience))
    });

    const entityTypeKey = normalizeKey(asString(entity.role));

    if (!entityTypeKey) {
      continue;
    }

    const entityTypeNode = await nodeStore.upsert(supabase, {
      nodeType: "entity_type",
      canonicalKey: entityTypeKey,
      displayLabel: asString(entity.role) ?? label
    });

    await upsertEdge(supabase, {
      edgeKey: buildEdgeKey("entity_instance_is_type", instanceNode.id, entityTypeNode.id),
      edgeType: "entity_instance_is_type",
      sourceNodeId: instanceNode.id,
      targetNodeId: entityTypeNode.id,
      weight: 0.9
    });
  }

  const relationships = Array.isArray(worldModel.relationshipGraph) ? worldModel.relationshipGraph : [];

  for (const relationship of relationships) {
    if (!isRecord(relationship)) {
      continue;
    }

    const sourceEntity = asString(relationship.sourceEntity);
    const targetEntity = asString(relationship.targetEntity);
    const dynamic = asString(relationship.dynamic);

    if (!sourceEntity || !targetEntity || !dynamic) {
      continue;
    }

    const sourceNodeId = entityNodeIds.get(sourceEntity);
    const targetNodeId = entityNodeIds.get(targetEntity);

    if (!sourceNodeId || !targetNodeId) {
      continue;
    }

    await upsertEdge(supabase, {
      edgeKey: buildEdgeKey("entity_instance_related_to_entity_instance", sourceNodeId, targetNodeId, sourceSongId),
      edgeType: "entity_instance_related_to_entity_instance",
      sourceNodeId,
      targetNodeId,
      sourceSongId,
      weight: confidenceToWeight(asString(relationship.confidence)),
      metadata: {
        dynamic,
        powerBalance: asString(relationship.powerBalance),
        evidence: asString(relationship.evidence),
        confidence: asString(relationship.confidence)
      },
      evidence: asString(relationship.evidence)
    });
  }
}

async function upsertTermLinks(supabase, nodeStore, artistNodeIds, songNodeId, sourceSongId, sourceLanguage, glossaryEntries, canonicalRenderings, lyricTexts) {
  const combinedEntries = [
    ...glossaryEntries,
    ...canonicalRenderings.map((entry) => ({
      term: entry.term,
      meaning: entry.rendering,
      note: entry.note,
      aliases: [],
      category: "preferred_rendering"
    }))
  ];

  for (const entry of combinedEntries) {
    const term = asString(entry.term);
    const meaning = asString(entry.meaning);
    const termKey = normalizeKey(term);
    const meaningKey = normalizeKey(meaning);

    if (!term || !meaning || !termKey || !meaningKey) {
      continue;
    }

    const aliases = Array.isArray(entry.aliases) ? entry.aliases.map((value) => asString(value)).filter(Boolean) : [];
    const note = asString(entry.note);
    const category = asString(entry.category) ?? "entry";

    const termNode = await nodeStore.upsert(supabase, {
      nodeType: "term_surface",
      canonicalKey: termKey,
      displayLabel: term,
      aliases,
      languageCode: sourceLanguage,
      description: note,
      metadata: { category }
    });

    const senseNode = await nodeStore.upsert(supabase, {
      nodeType: "term_sense",
      canonicalKey: buildTermSenseKey(sourceLanguage, term, meaning),
      displayLabel: `${term} -> ${meaning}`,
      languageCode: sourceLanguage,
      description: note ?? meaning,
      metadata: { term, meaning, note }
    });

    const renderingNode = await nodeStore.upsert(supabase, {
      nodeType: "rendering",
      canonicalKey: buildRenderingKey(meaning),
      displayLabel: meaning,
      description: note
    });

    await upsertEdge(supabase, {
      edgeKey: buildEdgeKey("term_surface_maps_to_term_sense", termNode.id, senseNode.id),
      edgeType: "term_surface_maps_to_term_sense",
      sourceNodeId: termNode.id,
      targetNodeId: senseNode.id,
      weight: 0.8,
      metadata: { note, category }
    });

    await upsertEdge(supabase, {
      edgeKey: buildEdgeKey("term_sense_prefers_rendering", senseNode.id, renderingNode.id),
      edgeType: "term_sense_prefers_rendering",
      sourceNodeId: senseNode.id,
      targetNodeId: renderingNode.id,
      weight: 0.9,
      metadata: { note }
    });

    for (const artistNodeId of artistNodeIds) {
      await upsertEdge(supabase, {
        edgeKey: buildEdgeKey("artist_uses_term_surface", artistNodeId, termNode.id),
        edgeType: "artist_uses_term_surface",
        sourceNodeId: artistNodeId,
        targetNodeId: termNode.id,
        weight: 0.7,
        metadata: { category }
      });

      await upsertEdge(supabase, {
        edgeKey: buildEdgeKey("artist_prefers_rendering", artistNodeId, renderingNode.id),
        edgeType: "artist_prefers_rendering",
        sourceNodeId: artistNodeId,
        targetNodeId: renderingNode.id,
        weight: 0.72,
        metadata: { term, note }
      });
    }

    if (termUsedInSong(term, aliases, lyricTexts)) {
      await upsertEdge(supabase, {
        edgeKey: buildEdgeKey("song_uses_term_surface", songNodeId, termNode.id, sourceSongId),
        edgeType: "song_uses_term_surface",
        sourceNodeId: songNodeId,
        targetNodeId: termNode.id,
        sourceSongId,
        weight: 0.75,
        metadata: { category }
      });
    }
  }
}

function parseRelationshipPriors(relationshipsJson) {
  if (!Array.isArray(relationshipsJson)) {
    return [];
  }

  return relationshipsJson
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const dynamic = asString(entry.dynamic);
      const powerBalance = asString(entry.powerBalance);

      if (!dynamic) {
        return null;
      }

      return powerBalance ? `${dynamic} (${powerBalance})` : dynamic;
    })
    .filter(Boolean);
}

function buildArtistStyleHints(artistNodes) {
  const hints = [];

  for (const artistNode of artistNodes) {
    const metadata = isRecord(artistNode.metadata) ? artistNode.metadata : {};
    const personaSummary = asString(metadata.personaSummary);

    if (personaSummary) {
      hints.push(personaSummary);
    }

    hints.push(
      ...asStringArray(metadata.translationDirectives),
      ...asStringArray(metadata.translationPreferences),
      ...asStringArray(metadata.voiceNotes),
      ...asStringArray(metadata.stanceNotes)
    );
  }

  return uniqStrings(hints).slice(0, 8);
}

function countBy(values) {
  const counts = new Map();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
}

function sortByCountDesc(counts) {
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value, count]) => ({ value, count }));
}

function buildMemoryPackFromWorldModels(artistNodes, worldModels, renderingHints) {
  const motifHints = sortByCountDesc(
    countBy([
      ...worldModels.flatMap((entry) => asStringArray(entry.core_motifs)),
      ...artistNodes.flatMap((node) => asStringArray(isRecord(node.metadata) ? node.metadata.recurringMotifs : []))
    ])
  ).slice(0, 10).map((entry) => entry.value);

  const relationshipPriors = sortByCountDesc(
    countBy(worldModels.flatMap((entry) => parseRelationshipPriors(entry.relationships_json)))
  ).slice(0, 8).map((entry) => entry.value);

  const symbolHints = sortByCountDesc(
    countBy(worldModels.flatMap((entry) => asStringArray(entry.recurring_symbols)))
  ).slice(0, 8).map((entry) => ({ symbol: entry.value, frequency: entry.count }));

  return {
    builtAt: new Date().toISOString(),
    artistKeys: uniqStrings(artistNodes.map((node) => normalizeKey(node.display_label))),
    sourceSongIds: uniqStrings(worldModels.map((entry) => entry.spotify_track_id)),
    styleHints: buildArtistStyleHints(artistNodes),
    motifHints,
    relationshipPriors,
    symbolHints,
    renderingHints
  };
}

async function writeMemoryPackCache(supabase, cacheKey, payload) {
  const { error } = await supabase.from("memory_pack_cache").upsert(
    {
      cache_key: cacheKey,
      pack_type: "translation",
      scope_type: "song",
      scope_key: cacheKey,
      payload_json: payload,
      version: 1,
      updated_at: new Date().toISOString()
    },
    { onConflict: "cache_key" }
  );

  if (error) {
    throw error;
  }
}

async function backfillArtistProfiles(supabase, nodeStore) {
  const profiles = await fetchAllRows((from, to) =>
    supabase.from("artist_profiles").select("artist_key, profile_json").range(from, to)
  );

  let successCount = 0;

  for (const row of profiles) {
    const artistKey = asString(row.artist_key);
    const profile = isRecord(row.profile_json) ? row.profile_json : {};

    if (!artistKey) {
      continue;
    }

    const artistNode = await nodeStore.upsert(supabase, {
      nodeType: "artist",
      canonicalKey: artistKey,
      displayLabel: asString(profile.displayName) ?? artistKey,
      aliases: [asString(profile.displayName) ?? artistKey],
      description: asString(profile.personaSummary),
      metadata: profile
    });

    await supabase.from("artist_profiles").update({ kg_node_id: artistNode.id }).eq("artist_key", artistKey);
    successCount += 1;
  }

  return {
    total: profiles.length,
    successCount,
    skippedCount: profiles.length - successCount
  };
}

async function backfillDrafts(supabase, nodeStore) {
  const drafts = await fetchAllRows((from, to) =>
    supabase
      .from("translation_drafts")
      .select("spotify_track_id, draft_json, updated_at")
      .order("updated_at", { ascending: true })
      .range(from, to)
  );

  let successCount = 0;
  let skippedCount = 0;

  for (const row of drafts) {
    try {
      const draft = isRecord(row.draft_json) ? row.draft_json : null;

      if (!draft) {
        skippedCount += 1;
        continue;
      }

      const spotifyTrackId = asString(draft.spotifyTrackId) ?? asString(row.spotify_track_id);
      const title = asString(draft.title);
      const artist = asString(draft.artist);

      if (!spotifyTrackId || !title) {
        skippedCount += 1;
        continue;
      }

      const songNode = await nodeStore.upsert(supabase, {
        nodeType: "song",
        canonicalKey: buildSongNodeKey(spotifyTrackId),
        displayLabel: title,
        aliases: [title],
        languageCode: asString(draft.sourceLanguage),
        description: asString(draft.songContext?.summary) ?? asString(draft.worldModel?.summary),
        metadata: {
          spotifyTrackId,
          title,
          artist,
          album: asString(draft.album),
          sourceLanguage: asString(draft.sourceLanguage),
          targetLanguage: asString(draft.targetLanguage),
          generatedAt: asString(draft.generatedAt) ?? asString(row.updated_at)
        }
      });

      const artistCredits = splitArtistCredits(artist);
      const primaryArtistKey = asString(draft.artistMemory?.artistKey) ?? artistCredits[0]?.key ?? null;
      const artistNodes = [];

      for (const credit of artistCredits) {
        const artistNode = await upsertArtistNode(
          supabase,
          nodeStore,
          credit.name,
          primaryArtistKey === credit.key && isRecord(draft.artistMemory) ? draft.artistMemory : null
        );

        if (!artistNode) {
          continue;
        }

        artistNodes.push(artistNode);

        await upsertEdge(supabase, {
          edgeKey: buildEdgeKey("artist_recorded_song", artistNode.id, songNode.id),
          edgeType: "artist_recorded_song",
          sourceNodeId: artistNode.id,
          targetNodeId: songNode.id,
          weight: 0.95
        });
      }

      await upsertPersonaStyleLinks(supabase, nodeStore, artistNodes.map((node) => node.id), isRecord(draft.artistMemory) ? draft.artistMemory : null);

      const motifs = uniqStrings([
        ...asStringArray(draft.songContext?.themes),
        ...asStringArray(draft.worldModel?.coreMotifs),
        ...asStringArray(draft.artistMemory?.recurringMotifs)
      ]);

      await upsertMotifLinks(supabase, nodeStore, songNode.id, artistNodes.map((node) => node.id), motifs, songNode.id);
      await upsertSymbolLinks(supabase, nodeStore, songNode.id, asStringArray(draft.worldModel?.recurringSymbols), songNode.id);
      await upsertEntityLinks(supabase, nodeStore, { ...draft, spotifyTrackId }, songNode.id, songNode.id);
      await upsertTermLinks(
        supabase,
        nodeStore,
        artistNodes.map((node) => node.id),
        songNode.id,
        songNode.id,
        asString(draft.sourceLanguage),
        Array.isArray(draft.artistMemory?.glossaryEntries) ? draft.artistMemory.glossaryEntries : [],
        Array.isArray(draft.artistMemory?.canonicalRenderings) ? draft.artistMemory.canonicalRenderings : [],
        Array.isArray(draft.lines) ? draft.lines.map((line) => asString(line.original)).filter(Boolean) : []
      );

      await upsertSongWorldModel(supabase, {
        songNodeId: songNode.id,
        spotifyTrackId,
        title,
        artist,
        artistKeys: artistCredits.map((credit) => credit.key),
        sourceLanguage: asString(draft.sourceLanguage),
        summary: asString(draft.worldModel?.summary) ?? asString(draft.songContext?.summary),
        speakerPersona: asString(draft.worldModel?.speakerPersona),
        addressee: asString(draft.worldModel?.addressee) ?? asString(draft.songContext?.addressee),
        narrativeDrive: asString(draft.worldModel?.narrativeDrive),
        dominantConflict: asString(draft.worldModel?.dominantConflict),
        worldState: asString(draft.worldModel?.worldState),
        coreMotifs: asStringArray(draft.worldModel?.coreMotifs).length > 0 ? asStringArray(draft.worldModel?.coreMotifs) : asStringArray(draft.songContext?.themes),
        recurringSymbols: asStringArray(draft.worldModel?.recurringSymbols),
        continuityRules: asStringArray(draft.worldModel?.continuityRules),
        entitiesJson: Array.isArray(draft.worldModel?.entities) ? draft.worldModel.entities : [],
        relationshipsJson: Array.isArray(draft.worldModel?.relationshipGraph) ? draft.worldModel.relationshipGraph : [],
        verseModelsJson: Array.isArray(draft.worldModel?.verseModels) ? draft.worldModel.verseModels : [],
        lineModelsJson: Array.isArray(draft.worldModel?.lineModels) ? draft.worldModel.lineModels : [],
        modelId: asString(draft.generator?.model),
        generatedAt: asString(draft.generatedAt) ?? new Date().toISOString()
      });

      successCount += 1;
    } catch (error) {
      console.error(`Brain draft backfill failed for ${row.spotify_track_id}:`, error instanceof Error ? error.message : String(error));
      skippedCount += 1;
    }
  }

  return {
    total: drafts.length,
    successCount,
    skippedCount
  };
}

async function backfillMemoryPackCache(supabase) {
  const artistNodes = await fetchAllRows((from, to) =>
    supabase.from("kg_nodes").select("id,node_type,display_label,metadata").eq("node_type", "artist").range(from, to)
  );
  const songWorldModels = await fetchAllRows((from, to) =>
    supabase.from("song_world_models").select("*").order("updated_at", { ascending: true }).range(from, to)
  );
  const artistSongEdges = await fetchAllRows((from, to) =>
    supabase.from("kg_edges").select("source_node_id,target_node_id,edge_type").eq("edge_type", "artist_recorded_song").range(from, to)
  );
  const renderingNodes = await fetchAllRows((from, to) =>
    supabase.from("kg_nodes").select("id,display_label,node_type").eq("node_type", "rendering").range(from, to)
  );
  const artistRenderingEdges = await fetchAllRows((from, to) =>
    supabase.from("kg_edges").select("source_node_id,target_node_id,metadata,edge_type").eq("edge_type", "artist_prefers_rendering").range(from, to)
  );

  const worldModelsBySongNode = new Map(songWorldModels.map((row) => [row.song_node_id, row]));
  const songsByArtistNodeId = new Map();

  for (const edge of artistSongEdges) {
    const entries = songsByArtistNodeId.get(edge.source_node_id) ?? [];
    entries.push(edge.target_node_id);
    songsByArtistNodeId.set(edge.source_node_id, entries);
  }

  let successCount = 0;
  let skippedCount = 0;

  for (const worldModel of songWorldModels) {
    try {
      const artistKeys = asStringArray(worldModel.artist_keys);
      const matchingArtistNodes = artistNodes.filter((node) => artistKeys.includes(normalizeKey(node.display_label)));
      const relatedSongNodeIds = uniqStrings(matchingArtistNodes.flatMap((node) => songsByArtistNodeId.get(node.id) ?? []));
      const relatedWorldModels = relatedSongNodeIds
        .map((songNodeId) => worldModelsBySongNode.get(songNodeId))
        .filter(Boolean);
      const renderingHints = artistRenderingEdges
        .filter((edge) => matchingArtistNodes.some((node) => node.id === edge.source_node_id))
        .map((edge) => {
          const renderingNode = renderingNodes.find((node) => node.id === edge.target_node_id);
          const term = isRecord(edge.metadata) ? asString(edge.metadata.term) : null;

          if (!renderingNode || !term) {
            return null;
          }

          return {
            term,
            meaning: renderingNode.display_label,
            note: isRecord(edge.metadata) ? asString(edge.metadata.note) : null,
            source: "brain_rendering"
          };
        })
        .filter(Boolean);

      const payload = buildMemoryPackFromWorldModels(matchingArtistNodes, relatedWorldModels, renderingHints);
      await writeMemoryPackCache(supabase, buildMemoryPackCacheKey(artistKeys, worldModel.spotify_track_id), payload);
      successCount += 1;
    } catch (error) {
      console.error(`Memory pack backfill failed for ${worldModel.spotify_track_id}:`, error instanceof Error ? error.message : String(error));
      skippedCount += 1;
    }
  }

  return {
    total: songWorldModels.length,
    successCount,
    skippedCount
  };
}

async function main() {
  const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  const nodeStore = createNodeStore();

  console.log("Starting Lafz Brain backfill...");

  const artistProfiles = await backfillArtistProfiles(supabase, nodeStore);
  const drafts = await backfillDrafts(supabase, nodeStore);
  const memoryPacks = await backfillMemoryPackCache(supabase);

  console.log("");
  console.log("Backfill complete.");
  console.log(JSON.stringify({ artistProfiles, drafts, memoryPacks }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
