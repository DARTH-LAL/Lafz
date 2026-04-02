import { createClient } from "@supabase/supabase-js";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function requiredAnyEnv(names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  throw new Error(`Missing required env var: one of ${names.join(", ")}`);
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

function stripCombiningMarks(value) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeKey(value) {
  if (!value) {
    return null;
  }

  const normalized = stripCombiningMarks(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : null;
}

function normalizeText(value) {
  if (!value) {
    return null;
  }

  const normalized = stripCombiningMarks(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ");

  return normalized.length > 0 ? normalized : null;
}

function uniqStrings(values) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean)));
}

function splitArtistCredits(artist) {
  if (!artist) {
    return [];
  }

  return artist
    .split(/\s*(?:,|&|\band\b|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bx\b)\s*/i)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((name) => ({ name, key: normalizeKey(name) }))
    .filter((entry) => Boolean(entry.key));
}

const ACTOR_ENTITY_KEYS = new Set([
  "narrator",
  "speaker",
  "self",
  "lover",
  "beloved",
  "girl",
  "boy",
  "woman",
  "man",
  "mother",
  "father",
  "family",
  "friend",
  "friends",
  "rival",
  "rivals",
  "hater",
  "haters",
  "people",
  "god",
  "rabb"
]);

const GROUP_ENTITY_KEYS = new Set([
  "crew",
  "gang",
  "team",
  "circle",
  "friends",
  "family",
  "rivals",
  "haters",
  "people",
  "audience"
]);

const EMBODIED_SYMBOL_ENTITY_KEYS = new Set([
  "heart",
  "dil",
  "soul",
  "mind",
  "eyes",
  "gaze",
  "glance",
  "breath",
  "voice"
]);

const STATUS_OBJECT_ENTITY_KEYS = new Set([
  "status",
  "money",
  "cash",
  "car",
  "cars",
  "chain",
  "jewelry",
  "hood",
  "land",
  "weapon",
  "weapons",
  "gun",
  "glock",
  "barood",
  "name",
  "reputation"
]);

const PLACE_ENTITY_KEYS = new Set([
  "city",
  "town",
  "village",
  "pind",
  "street",
  "streets",
  "road",
  "lane",
  "club",
  "home",
  "house",
  "shore",
  "river",
  "sea",
  "ocean"
]);

const BODY_PART_ENTITY_KEYS = new Set([
  "arm",
  "arms",
  "hand",
  "hands",
  "lips",
  "face",
  "chehra",
  "hair",
  "zulf",
  "zulfa",
  "head",
  "skin"
]);

const MATERIAL_OBJECT_ENTITY_KEYS = new Set([
  "pearl",
  "pearls",
  "flower",
  "flowers",
  "rose",
  "roses",
  "mirror",
  "bottle",
  "veil"
]);

const ABSTRACT_ENTITY_KEYS = new Set([
  "love",
  "ishq",
  "truth",
  "honesty",
  "art",
  "music",
  "rap",
  "beauty",
  "fate",
  "destiny"
]);

const SYMBOLIC_ENTITY_KEYS = new Set([
  "weather",
  "season",
  "night",
  "mask",
  "concealment",
  "shadow",
  "signal",
  "omen"
]);

const RELATIONSHIP_FAMILY_RULES = [
  {
    canonicalKey: "warning-and-dominance",
    displayLabel: "warning and dominance",
    keywords: ["warning", "threat", "taunt", "dominance", "control", "enemy", "rival", "pressure", "fear"]
  },
  {
    canonicalKey: "loyalty-and-backing",
    displayLabel: "loyalty and backing",
    keywords: ["loyalty", "support", "backing", "solidarity", "ride", "with", "trust", "protection"]
  },
  {
    canonicalKey: "devotion-and-longing",
    displayLabel: "devotion and longing",
    keywords: ["devotion", "longing", "yearning", "missing", "desire", "obsession", "urge", "pull", "call"]
  },
  {
    canonicalKey: "healing-and-reassurance",
    displayLabel: "healing and reassurance",
    keywords: ["heal", "comfort", "confirm", "reassure", "safe", "steady", "response"]
  },
  {
    canonicalKey: "teasing-and-attraction",
    displayLabel: "teasing and attraction",
    keywords: ["teasing", "flirt", "playful", "charm", "attraction", "captivation", "admiration"]
  },
  {
    canonicalKey: "status-and-display",
    displayLabel: "status and display",
    keywords: ["status", "display", "public", "reputation", "hype", "image", "spectacle"]
  },
  {
    canonicalKey: "symbolic-cue",
    displayLabel: "symbolic cue",
    keywords: ["sign", "cue", "signal", "omen", "weather", "fate"]
  }
];

function classifyEntity(entityKey, label, description) {
  const normalizedKey = normalizeKey(entityKey);

  if (normalizedKey) {
    if (ACTOR_ENTITY_KEYS.has(normalizedKey)) return GROUP_ENTITY_KEYS.has(normalizedKey) ? "group" : "actor";
    if (GROUP_ENTITY_KEYS.has(normalizedKey)) return "group";
    if (EMBODIED_SYMBOL_ENTITY_KEYS.has(normalizedKey)) return "embodied_symbol";
    if (STATUS_OBJECT_ENTITY_KEYS.has(normalizedKey)) return "status_object";
    if (PLACE_ENTITY_KEYS.has(normalizedKey)) return "place";
    if (BODY_PART_ENTITY_KEYS.has(normalizedKey)) return "body_part";
    if (MATERIAL_OBJECT_ENTITY_KEYS.has(normalizedKey)) return "material_object";
    if (ABSTRACT_ENTITY_KEYS.has(normalizedKey)) return "abstract";
    if (SYMBOLIC_ENTITY_KEYS.has(normalizedKey)) return "symbolic";
  }

  const normalizedText = normalizeText([label, description].filter(Boolean).join(" "));
  if (!normalizedText) return "other";

  if (/\b(crew|friends|circle|family|rivals|haters|people|audience)\b/.test(normalizedText)) return "group";
  if (/\b(narrator|speaker|lover|beloved|girl|boy|woman|man|mother|father|god|rabb)\b/.test(normalizedText)) return "actor";
  if (/\b(heart|soul|mind|eyes|gaze|glance|voice|breath)\b/.test(normalizedText)) return "embodied_symbol";
  if (/\b(status|money|cash|car|cars|chain|jewelry|hood|land|weapon|weapons|gun|glock|name|reputation)\b/.test(normalizedText)) return "status_object";
  if (/\b(city|town|village|pind|street|streets|road|lane|club|home|house|shore|river|sea|ocean)\b/.test(normalizedText)) return "place";
  if (/\b(arm|arms|hand|hands|lips|face|chehra|hair|zulf|zulfa|head|skin)\b/.test(normalizedText)) return "body_part";
  if (/\b(pearl|pearls|flower|flowers|rose|roses|mirror|bottle|veil)\b/.test(normalizedText)) return "material_object";
  if (/\b(weather|season|night|mask|concealment|shadow|signal|omen)\b/.test(normalizedText)) return "symbolic";
  if (/\b(love|ishq|truth|honesty|art|music|rap|beauty|fate|destiny)\b/.test(normalizedText)) return "abstract";

  return "other";
}

function canonicalizeRelationshipDynamic(dynamic, sourceEntityKey, targetEntityKey) {
  const normalized = normalizeText(dynamic);
  const fallbackKey = normalizeKey(dynamic ?? "");
  const fallbackLabel = dynamic?.trim();

  if (!normalized || !fallbackKey || !fallbackLabel) {
    return null;
  }

  const combined = [normalized, normalizeText(sourceEntityKey), normalizeText(targetEntityKey)]
    .filter(Boolean)
    .join(" ");

  for (const rule of RELATIONSHIP_FAMILY_RULES) {
    if (rule.keywords.some((keyword) => combined.includes(keyword))) {
      return {
        canonicalKey: rule.canonicalKey,
        displayLabel: rule.displayLabel,
        sourceLabel: fallbackLabel
      };
    }
  }

  return {
    canonicalKey: fallbackKey,
    displayLabel: fallbackLabel,
    sourceLabel: fallbackLabel
  };
}

function isReusableArtistEntityClass(entityClass) {
  return (
    entityClass === "actor" ||
    entityClass === "group" ||
    entityClass === "embodied_symbol" ||
    entityClass === "status_object"
  );
}

async function fetchAllRows(queryFactory, batchSize = 500) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + batchSize - 1;
    const { data, error } = await queryFactory(from, to);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  return rows;
}

function mergeMetadata(base, patch) {
  const next = isRecord(base) ? { ...base } : {};

  for (const [key, value] of Object.entries(patch)) {
    if (isRecord(value) && isRecord(next[key])) {
      next[key] = mergeMetadata(next[key], value);
      continue;
    }
    next[key] = value;
  }

  return next;
}

async function main() {
  const supabaseUrl = requiredAnyEnv(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const appUrl = process.env.LAFZ_APP_URL?.trim() || "http://127.0.0.1:3000";
  const runnerSecret = requiredEnv("LAFZ_AGENT_RUNNER_SECRET");
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const now = new Date().toISOString();

  const [artistNodes, entityNodes, edges, claimRows, draftRows, cacheRows] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase.from("kg_nodes").select("id, canonical_key, display_label").eq("node_type", "artist").range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("kg_nodes")
        .select("id, canonical_key, display_label, description, metadata, is_active")
        .eq("node_type", "entity_type")
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("kg_edges")
        .select("id, edge_type, source_node_id, target_node_id, source_song_id, metadata, is_active")
        .in("edge_type", ["artist_associates_entity_type", "entity_type_related_to_entity_type"])
        .eq("is_active", true)
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("kg_claims")
        .select("id, claim_type, status, scope_key, payload_json, updated_at")
        .in("claim_type", ["artist_entity_role_observation", "artist_relationship_pattern_observation"])
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase.from("translation_drafts").select("spotify_track_id, draft_json, updated_at").range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase.from("memory_pack_cache").select("cache_key, payload_json").range(from, to)
    )
  ]);

  const artistNodeById = new Map(
    artistNodes
      .map((row) => [asString(row.id), { id: asString(row.id), key: asString(row.canonical_key), label: asString(row.display_label) }] )
      .filter((entry) => entry[0] && entry[1].key)
  );
  const artistNodeByKey = new Map(Array.from(artistNodeById.values()).map((artist) => [artist.key, artist]));
  const entityNodeById = new Map(entityNodes.map((row) => [row.id, row]));
  const trackMetaById = new Map();

  for (const row of draftRows) {
    const draft = isRecord(row.draft_json) ? row.draft_json : null;
    const trackId = asString(draft?.spotifyTrackId) ?? asString(row.spotify_track_id);
    const artist = asString(draft?.artist);
    if (!trackId || !artist) continue;
    const credits = splitArtistCredits(artist);
    trackMetaById.set(trackId, {
      artist,
      artistKeys: credits.map((credit) => credit.key),
      primaryArtistKey: credits[0]?.key ?? null
    });
  }

  const activeEdges = edges.filter((edge) => edge.is_active !== false);
  const activeEdgesByClaimId = new Map();
  for (const edge of activeEdges) {
    const claimId = asString(edge.metadata?.materializedFromClaimId);
    if (!claimId) continue;
    const bucket = activeEdgesByClaimId.get(claimId) ?? [];
    bucket.push(edge);
    activeEdgesByClaimId.set(claimId, bucket);
  }

  const touchedArtistKeys = new Set();
  let collaboratorBleedClaimsDeprecated = 0;
  let collaboratorBleedEdgesDeactivated = 0;

  for (const claim of claimRows) {
    const payload = isRecord(claim.payload_json) ? claim.payload_json : {};
    const artistKey = asString(payload.artistKey) ?? asString(claim.scope_key);
    const trackId = asString(payload.spotifyTrackId);
    const attributionMode = asString(payload.attributionMode);
    const materialization = isRecord(payload.materialization) ? payload.materialization : {};
    const materializationStatus = asString(materialization.status);
    const trackMeta = trackId ? trackMetaById.get(trackId) : null;

    if (
      !artistKey ||
      !trackMeta ||
      trackMeta.artistKeys.length <= 1 ||
      artistKey === trackMeta.primaryArtistKey ||
      attributionMode === "primary_artist_only" ||
      materializationStatus !== "materialized" ||
      claim.status !== "accepted"
    ) {
      continue;
    }

    const nextPayload = mergeMetadata(payload, {
      reconciliation: {
        entityV3: {
          deprecatedAt: now,
          rule: "collaborator_bleed_primary_artist_only",
          primaryArtistKey: trackMeta.primaryArtistKey,
          previousArtistKey: artistKey
        }
      },
      materialization: {
        ...materialization,
        status: "reconciled_collaborator_bleed",
        materializedAt: now
      }
    });

    const { error: claimError } = await supabase
      .from("kg_claims")
      .update({
        status: "deprecated",
        payload_json: nextPayload,
        updated_at: now
      })
      .eq("id", claim.id);

    if (claimError) {
      throw claimError;
    }

    collaboratorBleedClaimsDeprecated += 1;
    touchedArtistKeys.add(artistKey);
    if (trackMeta.primaryArtistKey) touchedArtistKeys.add(trackMeta.primaryArtistKey);
    claim.status = "deprecated";
    claim.payload_json = nextPayload;

    for (const edge of activeEdgesByClaimId.get(claim.id) ?? []) {
      const nextMetadata = mergeMetadata(edge.metadata, {
        reconciliation: {
          entityV3: {
            deactivatedAt: now,
            rule: "collaborator_bleed_primary_artist_only",
            claimId: claim.id
          }
        }
      });

      const { error: edgeError } = await supabase
        .from("kg_edges")
        .update({
          is_active: false,
          metadata: nextMetadata,
          updated_at: now
        })
        .eq("id", edge.id);

      if (edgeError) {
        throw edgeError;
      }

      collaboratorBleedEdgesDeactivated += 1;
    }
  }

  let claimEntityClassesUpdated = 0;

  for (const claim of claimRows) {
    const payload = isRecord(claim.payload_json) ? claim.payload_json : {};
    const artistKey = asString(payload.artistKey) ?? asString(claim.scope_key);
    const nextPayload = { ...payload };
    let changed = false;

    if (claim.claim_type === "artist_entity_role_observation") {
      const nextEntityClass = classifyEntity(
        asString(payload.entityKey),
        asString(payload.entityRole) ?? asString(payload.entityLabel),
        asString(payload.description)
      );
      if (asString(payload.entityClass) !== nextEntityClass) {
        nextPayload.entityClass = nextEntityClass;
        changed = true;
      }
    }

    if (claim.claim_type === "artist_relationship_pattern_observation") {
      const nextSourceClass = classifyEntity(asString(payload.sourceEntityKey), asString(payload.sourceRole), null);
      const nextTargetClass = classifyEntity(asString(payload.targetEntityKey), asString(payload.targetRole), null);
      if (asString(payload.sourceEntityClass) !== nextSourceClass) {
        nextPayload.sourceEntityClass = nextSourceClass;
        changed = true;
      }
      if (asString(payload.targetEntityClass) !== nextTargetClass) {
        nextPayload.targetEntityClass = nextTargetClass;
        changed = true;
      }
    }

    if (!changed) {
      continue;
    }

    nextPayload.reconciliation = mergeMetadata(isRecord(nextPayload.reconciliation) ? nextPayload.reconciliation : {}, {
      entityV4: {
        taxonomyTightenedAt: now
      }
    });

    const { error } = await supabase
      .from("kg_claims")
      .update({
        payload_json: nextPayload,
        updated_at: now
      })
      .eq("id", claim.id);

    if (error) {
      throw error;
    }

    claimEntityClassesUpdated += 1;
    if (artistKey) touchedArtistKeys.add(artistKey);
    claim.payload_json = nextPayload;
  }

  let staleMaterializedClaimsReconciled = 0;
  let staleMaterializedEdgesDeactivated = 0;

  for (const claim of claimRows) {
    const payload = isRecord(claim.payload_json) ? claim.payload_json : {};
    const artistKey = asString(payload.artistKey) ?? asString(claim.scope_key);
    const materialization = isRecord(payload.materialization) ? payload.materialization : {};
    const materializationStatus = asString(materialization.status);
    const activeClaimEdges = activeEdgesByClaimId.get(claim.id) ?? [];

    if (activeClaimEdges.length === 0 && materializationStatus !== "materialized") {
      continue;
    }

    let shouldRemainMaterialized = claim.status === "accepted";
    let nextMaterializationStatus = materializationStatus;

    if (claim.claim_type === "artist_entity_role_observation") {
      const entityClass = classifyEntity(
        asString(payload.entityKey),
        asString(payload.entityRole) ?? asString(payload.entityLabel),
        asString(payload.description)
      );
      shouldRemainMaterialized = shouldRemainMaterialized && isReusableArtistEntityClass(entityClass);
      if (!shouldRemainMaterialized) {
        nextMaterializationStatus = "reconciled_non_reusable_entity";
      }
    }

    if (claim.claim_type === "artist_relationship_pattern_observation") {
      const sourceEntityClass = classifyEntity(asString(payload.sourceEntityKey), asString(payload.sourceRole), null);
      const targetEntityClass = classifyEntity(asString(payload.targetEntityKey), asString(payload.targetRole), null);
      shouldRemainMaterialized =
        shouldRemainMaterialized &&
        isReusableArtistEntityClass(sourceEntityClass) &&
        isReusableArtistEntityClass(targetEntityClass);
      if (!shouldRemainMaterialized) {
        nextMaterializationStatus = "reconciled_non_reusable_pattern";
      }
    }

    if (shouldRemainMaterialized) {
      continue;
    }

    const nextPayload = mergeMetadata(payload, {
      reconciliation: {
        entityV4: {
          deactivatedAt: now,
          rule: "non_reusable_entity_taxonomy"
        }
      },
      materialization: {
        ...materialization,
        status: nextMaterializationStatus ?? "reconciled_stale_materialization",
        materializedAt: now
      }
    });

    const nextStatus = claim.status === "accepted" ? "deprecated" : claim.status;
    const { error: claimError } = await supabase
      .from("kg_claims")
      .update({
        status: nextStatus,
        payload_json: nextPayload,
        updated_at: now
      })
      .eq("id", claim.id);

    if (claimError) {
      throw claimError;
    }

    claim.status = nextStatus;
    claim.payload_json = nextPayload;
    staleMaterializedClaimsReconciled += 1;
    if (artistKey) touchedArtistKeys.add(artistKey);

    for (const edge of activeClaimEdges) {
      const nextMetadata = mergeMetadata(edge.metadata, {
        reconciliation: {
          entityV4: {
            deactivatedAt: now,
            rule: "non_reusable_entity_taxonomy",
            claimId: claim.id
          }
        }
      });

      const { error: edgeError } = await supabase
        .from("kg_edges")
        .update({
          is_active: false,
          metadata: nextMetadata,
          updated_at: now
        })
        .eq("id", edge.id);

      if (edgeError) {
        throw edgeError;
      }

      staleMaterializedEdgesDeactivated += 1;
    }
  }

  let entityClassesBackfilled = 0;
  const entityNodeArtistKeys = new Map();

  for (const row of entityNodes) {
    const metadata = isRecord(row.metadata) ? row.metadata : {};
    const previousEntityClass = asString(metadata.entityClass);
    const entityClass = classifyEntity(row.canonical_key, row.display_label, row.description);

    if (previousEntityClass === entityClass) {
      continue;
    }

    const nextMetadata = mergeMetadata(metadata, {
      entityClass,
      reconciliation: {
        entityV4: {
          backfilledAt: now
        }
      }
    });

    const { error } = await supabase
      .from("kg_nodes")
      .update({
        metadata: nextMetadata,
        updated_at: now
      })
      .eq("id", row.id);

    if (error) {
      throw error;
    }

    entityClassesBackfilled += 1;
    entityNodeById.set(row.id, { ...row, metadata: nextMetadata });
  }

  for (const edge of activeEdges.filter((edge) => edge.edge_type === "artist_associates_entity_type")) {
    const artist = artistNodeById.get(edge.source_node_id);
    if (!artist) continue;
    const bucket = entityNodeArtistKeys.get(edge.target_node_id) ?? new Set();
    bucket.add(artist.key);
    entityNodeArtistKeys.set(edge.target_node_id, bucket);
  }

  let relationshipFamiliesBackfilled = 0;

  for (const edge of activeEdges.filter((candidate) => candidate.edge_type === "entity_type_related_to_entity_type")) {
    const metadata = isRecord(edge.metadata) ? edge.metadata : {};
    const sourceNode = entityNodeById.get(edge.source_node_id);
    const targetNode = entityNodeById.get(edge.target_node_id);
    const sourceKey = asString(sourceNode?.canonical_key);
    const targetKey = asString(targetNode?.canonical_key);
    const dynamic = asString(metadata.dynamic) ?? asString(metadata.dynamicFamilyLabel);
    const dynamicFamily = canonicalizeRelationshipDynamic(dynamic, sourceKey, targetKey);
    const nextMetadata = mergeMetadata(metadata, {
      dynamicFamilyKey: dynamicFamily?.canonicalKey ?? null,
      dynamicFamilyLabel: dynamicFamily?.displayLabel ?? dynamic ?? null,
      reconciliation: {
        entityV4: {
          normalizedAt: now
        }
      }
    });

    if (
      asString(metadata.dynamicFamilyKey) === asString(nextMetadata.dynamicFamilyKey) &&
      asString(metadata.dynamicFamilyLabel) === asString(nextMetadata.dynamicFamilyLabel)
    ) {
      continue;
    }

    const { error } = await supabase
      .from("kg_edges")
      .update({
        metadata: nextMetadata,
        updated_at: now
      })
      .eq("id", edge.id);

    if (error) {
      throw error;
    }

    relationshipFamiliesBackfilled += 1;

    const artist = artistNodeById.get(edge.source_song_id);
    if (artist?.key) touchedArtistKeys.add(artist.key);
    for (const key of entityNodeArtistKeys.get(edge.source_node_id) ?? []) touchedArtistKeys.add(key);
    for (const key of entityNodeArtistKeys.get(edge.target_node_id) ?? []) touchedArtistKeys.add(key);
  }

  for (const [nodeId, keys] of entityNodeArtistKeys.entries()) {
    if (!entityNodeById.has(nodeId)) continue;
    for (const key of keys) touchedArtistKeys.add(key);
  }

  const affectedArtistKeys = Array.from(touchedArtistKeys);
  const cacheKeysToDelete = cacheRows
    .filter((row) => {
      const payload = isRecord(row.payload_json) ? row.payload_json : {};
      const payloadArtistKeys = asStringArray(payload.artistKeys);
      return payloadArtistKeys.some((value) => affectedArtistKeys.includes(value));
    })
    .map((row) => asString(row.cache_key))
    .filter((value) => Boolean(value));

  let invalidatedMemoryPacks = 0;
  if (cacheKeysToDelete.length > 0) {
    const { error } = await supabase.from("memory_pack_cache").delete().in("cache_key", cacheKeysToDelete);
    if (error) throw error;
    invalidatedMemoryPacks = cacheKeysToDelete.length;
  }

  const rebuildTargets = draftRows
    .map((row) => {
      const draft = isRecord(row.draft_json) ? row.draft_json : null;
      const spotifyTrackId = asString(draft?.spotifyTrackId) ?? asString(row.spotify_track_id);
      const artist = asString(draft?.artist);
      if (!spotifyTrackId || !artist) return null;
      const artistKeys = splitArtistCredits(artist).map((credit) => credit.key);
      return artistKeys.some((key) => affectedArtistKeys.includes(key))
        ? { spotifyTrackId, artist }
        : null;
    })
    .filter((value) => Boolean(value));

  let memoryPacksRebuilt = 0;
  const rebuildErrors = [];

  for (const target of rebuildTargets) {
    try {
      const response = await fetch(`${appUrl.replace(/\/$/, "")}/api/internal/brain/rebuild-memory-pack`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${runnerSecret}`
        },
        body: JSON.stringify(target)
      });

      if (!response.ok) {
        const body = await response.text();
        rebuildErrors.push({ ...target, status: response.status, body });
        continue;
      }

      memoryPacksRebuilt += 1;
    } catch (error) {
      rebuildErrors.push({
        ...target,
        status: "fetch_error",
        body: error instanceof Error ? error.message : String(error)
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        collaboratorBleedClaimsDeprecated,
        collaboratorBleedEdgesDeactivated,
        claimEntityClassesUpdated,
        staleMaterializedClaimsReconciled,
        staleMaterializedEdgesDeactivated,
        entityClassesBackfilled,
        relationshipFamiliesBackfilled,
        affectedArtistKeys,
        invalidatedMemoryPacks,
        memoryPacksRebuilt,
        rebuildErrors: rebuildErrors.slice(0, 10)
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
