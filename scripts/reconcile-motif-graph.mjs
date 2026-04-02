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

const MOTIF_TAXONOMY_RULES = [
  {
    canonicalKey: "loyalty-and-crew",
    displayLabel: "loyalty and crew",
    keywords: ["loyalty", "crew", "friends", "friendship", "yaari", "camaraderie", "brotherhood", "keeping one", "tooli", "squad", "backing"]
  },
  {
    canonicalKey: "longing-and-absence",
    displayLabel: "longing and absence",
    keywords: ["longing", "absence", "distance", "overseas", "missing", "unfulfilled", "restless", "sleepless", "yearning"]
  },
  {
    canonicalKey: "heartbreak-and-betrayal",
    displayLabel: "heartbreak and betrayal",
    keywords: ["heartbreak", "broken", "betrayal", "broken trust", "pain", "aftermath", "regret", "snake", "snake-like", "shady scheme", "shady schemes", "schemes", "shady behavior", "distrust", "deception", "two-faced"]
  },
  {
    canonicalKey: "romance-and-devotion",
    displayLabel: "romance and devotion",
    keywords: ["romantic", "romance", "devotion", "love", "beloved", "togetherness", "companion", "affection", "hand-holding", "hand holding", "meeting face to face", "face to face", "close together", "future together"]
  },
  {
    canonicalKey: "beauty-and-attraction",
    displayLabel: "beauty and attraction",
    keywords: ["beauty", "eyes", "gaze", "admiration", "attraction", "captivation", "praise", "kajal", "hair let down"]
  },
  {
    canonicalKey: "pride-and-identity",
    displayLabel: "pride and identity",
    keywords: ["identity", "jatt", "desi", "punjabi", "roots", "pride", "masculine", "chant", "discipline", "fitness"]
  },
  {
    canonicalKey: "status-and-luxury",
    displayLabel: "status and luxury",
    keywords: ["luxury", "status", "money", "cars", "rolls", "daytona", "fashion", "wealth", "showing off"]
  },
  {
    canonicalKey: "rivalry-and-dominance",
    displayLabel: "rivalry and dominance",
    keywords: ["rivals", "dominance", "fearlessness", "warning", "power", "outsiders", "bravado", "taunt", "keeping score", "score", "accounts", "books", "battle", "readiness", "targets", "target", "shooting", "beatings", "menace", "retaliation", "intimidation", "pressure", "weapon", "weapons", "violence", "weapons and violence"]
  },
  {
    canonicalKey: "legal-trouble-and-surveillance",
    displayLabel: "legal trouble and surveillance",
    keywords: ["police", "station", "prison", "jail", "court", "case files", "casefile", "law enforcement", "surveillance", "raids", "custody"]
  },
  {
    canonicalKey: "nightlife-and-partying",
    displayLabel: "nightlife and partying",
    keywords: ["nightlife", "party", "club", "drinking", "dancing", "celebration"]
  },
  {
    canonicalKey: "faith-and-destiny",
    displayLabel: "faith and destiny",
    keywords: ["faith", "god", "rabb", "divine", "destiny", "compatibility", "fate"]
  },
  {
    canonicalKey: "family-and-commitment",
    displayLabel: "family and commitment",
    keywords: ["family", "father", "marriage", "approval", "commitment", "boyfriend", "future together", "settling down"]
  },
  {
    canonicalKey: "art-and-self-expression",
    displayLabel: "art and self-expression",
    keywords: ["art", "rap", "expression", "testimony", "music", "lyrics", "artist tags"]
  },
  {
    canonicalKey: "emotional-turmoil",
    displayLabel: "emotional turmoil",
    keywords: ["emotional", "vulnerability", "shaken", "denial", "suffering", "turmoil", "obsession", "dependence"]
  },
  {
    canonicalKey: "public-attention-and-hype",
    displayLabel: "public attention and hype",
    keywords: ["public attention", "hype", "global", "mobility", "spotlight", "city-wide", "city wide", "whole city", "the whole city", "public notice", "gossip", "buzz", "talking", "public judgment", "judgment dismissed"]
  }
];

const CANONICAL_MOTIF_KEYS = new Set(MOTIF_TAXONOMY_RULES.map((rule) => rule.canonicalKey));

function canonicalizeMotif(value) {
  const normalized = normalizeText(value);
  const fallbackKey = normalizeKey(value ?? "");
  const fallbackLabel = value?.trim();

  if (!normalized || !fallbackKey || !fallbackLabel) {
    return null;
  }

  for (const rule of MOTIF_TAXONOMY_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
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

function isCanonicalMotifNode(displayLabel, canonicalKey) {
  const trimmedLabel = asString(displayLabel);
  const trimmedKey = asString(canonicalKey);

  if (!trimmedLabel || !trimmedKey) {
    return false;
  }

  const canonicalMotif = canonicalizeMotif(trimmedLabel);

  return Boolean(
    canonicalMotif &&
      canonicalMotif.canonicalKey === trimmedKey &&
      canonicalMotif.displayLabel === trimmedLabel &&
      CANONICAL_MOTIF_KEYS.has(trimmedKey)
  );
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

async function main() {
  const supabaseUrl = requiredAnyEnv(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const appUrl = process.env.LAFZ_APP_URL?.trim() || "http://127.0.0.1:3000";
  const runnerSecret = requiredEnv("LAFZ_AGENT_RUNNER_SECRET");
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const now = new Date().toISOString();

  const [artistNodes, motifNodes, motifEdges, cacheRows, draftRows] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase.from("kg_nodes").select("id, canonical_key").eq("node_type", "artist").range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("kg_nodes")
        .select("id, canonical_key, display_label, metadata, is_active")
        .eq("node_type", "motif")
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("kg_edges")
        .select("id, source_node_id, target_node_id, metadata, is_active")
        .eq("edge_type", "artist_exhibits_motif")
        .eq("is_active", true)
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase.from("memory_pack_cache").select("cache_key, payload_json").range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase.from("translation_drafts").select("spotify_track_id, draft_json, updated_at").range(from, to)
    )
  ]);

  const artistKeyById = new Map(
    artistNodes
      .map((row) => [asString(row.id), asString(row.canonical_key)])
      .filter((entry) => entry[0] && entry[1])
  );
  const motifNodeById = new Map(
    motifNodes
      .map((row) => [asString(row.id), row])
      .filter((entry) => entry[0])
  );

  const touchedArtistKeys = new Set();
  let legacyEdgesDeprecated = 0;
  let canonicalLegacyEdgesKept = 0;
  let claimBackedEdgesKept = 0;

  for (const edge of motifEdges) {
    const edgeId = asString(edge.id);
    const sourceNodeId = asString(edge.source_node_id);
    const targetNodeId = asString(edge.target_node_id);
    const metadata = isRecord(edge.metadata) ? edge.metadata : {};
    const artistKey = sourceNodeId ? artistKeyById.get(sourceNodeId) : null;
    const motifNode = targetNodeId ? motifNodeById.get(targetNodeId) : null;

    if (!edgeId || !artistKey || !motifNode) {
      continue;
    }

    const isClaimBacked = Boolean(asString(metadata.materializedFromClaimId));
    const isCanonicalFamily = isCanonicalMotifNode(motifNode.display_label, motifNode.canonical_key);

    if (isClaimBacked) {
      claimBackedEdgesKept += 1;
      continue;
    }

    if (isCanonicalFamily) {
      canonicalLegacyEdgesKept += 1;
      continue;
    }

    const nextMetadata = mergeMetadata(metadata, {
      reconciliation: {
        motifV2: {
          deactivatedAt: now,
          rule: "legacy_noncanonical_artist_motif_edge",
          artistKey,
          motifNodeId: targetNodeId,
          motifCanonicalKey: asString(motifNode.canonical_key),
          motifDisplayLabel: asString(motifNode.display_label)
        }
      }
    });

    const { error } = await supabase
      .from("kg_edges")
      .update({
        is_active: false,
        metadata: nextMetadata,
        updated_at: now
      })
      .eq("id", edgeId);

    if (error) {
      throw error;
    }

    legacyEdgesDeprecated += 1;
    touchedArtistKeys.add(artistKey);
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

    if (error) {
      throw error;
    }

    invalidatedMemoryPacks = cacheKeysToDelete.length;
  }

  const rebuildTargets = draftRows
    .map((row) => {
      const draft = isRecord(row.draft_json) ? row.draft_json : null;
      const spotifyTrackId = asString(draft?.spotifyTrackId) ?? asString(row.spotify_track_id);
      const artist = asString(draft?.artist);

      if (!spotifyTrackId || !artist) {
        return null;
      }

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
        rebuildErrors.push({
          ...target,
          status: response.status,
          body: await response.text()
        });
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
        legacyEdgesDeprecated,
        canonicalLegacyEdgesKept,
        claimBackedEdgesKept,
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
