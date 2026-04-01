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
    ? value.map((entry) => asString(entry)).filter(Boolean)
    : [];
}

function normalizeKey(value) {
  if (!value) {
    return null;
  }

  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
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

  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ");

  return normalized.length > 0 ? normalized : null;
}

function uniqStrings(values) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean)));
}

function buildEdgeKey(edgeType, sourceNodeId, targetNodeId, sourceSongId) {
  return [edgeType, sourceNodeId, targetNodeId, sourceSongId ?? "global"].join("::");
}

const GENERIC_SYMBOL_KEYS = new Set([
  "eyes",
  "eye",
  "heart",
  "mind",
  "world",
  "dream",
  "dreams",
  "night",
  "nights",
  "pain",
  "tears",
  "smile"
]);

const GENERIC_MOTIF_KEYS = new Set([
  "love",
  "romance",
  "sadness",
  "emotion",
  "feelings",
  "beauty",
  "memory",
  "memories"
]);

const MOTIF_TAXONOMY_RULES = [
  { canonicalKey: "loyalty-and-crew", displayLabel: "loyalty and crew", keywords: ["loyalty", "crew", "friends", "friendship", "yaari", "camaraderie", "brotherhood", "keeping one"] },
  { canonicalKey: "longing-and-absence", displayLabel: "longing and absence", keywords: ["longing", "absence", "distance", "overseas", "missing", "unfulfilled", "restless", "sleepless"] },
  { canonicalKey: "heartbreak-and-betrayal", displayLabel: "heartbreak and betrayal", keywords: ["heartbreak", "broken", "betrayal", "broken trust", "pain", "aftermath", "regret"] },
  { canonicalKey: "romance-and-devotion", displayLabel: "romance and devotion", keywords: ["romantic", "romance", "devotion", "love", "beloved", "togetherness", "companion", "affection"] },
  { canonicalKey: "beauty-and-attraction", displayLabel: "beauty and attraction", keywords: ["beauty", "eyes", "gaze", "admiration", "attraction", "captivation", "praise"] },
  { canonicalKey: "pride-and-identity", displayLabel: "pride and identity", keywords: ["identity", "jatt", "desi", "punjabi", "roots", "pride", "masculine", "chant"] },
  { canonicalKey: "status-and-luxury", displayLabel: "status and luxury", keywords: ["luxury", "status", "money", "cars", "rolls", "daytona", "fashion", "wealth"] },
  { canonicalKey: "rivalry-and-dominance", displayLabel: "rivalry and dominance", keywords: ["rivals", "dominance", "fearlessness", "warning", "power", "outsiders", "bravado", "taunt"] },
  { canonicalKey: "nightlife-and-partying", displayLabel: "nightlife and partying", keywords: ["nightlife", "party", "club", "drinking", "dancing", "celebration"] },
  { canonicalKey: "faith-and-destiny", displayLabel: "faith and destiny", keywords: ["faith", "god", "rabb", "divine", "destiny", "compatibility", "fate"] },
  { canonicalKey: "family-and-commitment", displayLabel: "family and commitment", keywords: ["family", "father", "marriage", "approval", "commitment", "boyfriend"] },
  { canonicalKey: "art-and-self-expression", displayLabel: "art and self-expression", keywords: ["art", "rap", "expression", "testimony", "music", "lyrics", "artist tags"] },
  { canonicalKey: "emotional-turmoil", displayLabel: "emotional turmoil", keywords: ["emotional", "vulnerability", "shaken", "denial", "suffering", "turmoil", "obsession", "dependence"] },
  { canonicalKey: "public-attention-and-hype", displayLabel: "public attention and hype", keywords: ["public attention", "hype", "global", "mobility", "spotlight"] }
];

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

function tokenizeText(value) {
  const normalized = value
    ?.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ");

  return normalized ? normalized.split(" ").filter(Boolean) : [];
}

function isMultiToken(label) {
  return tokenizeText(label).length > 1;
}

function evaluatePolicy(nodeType, label) {
  const key = normalizeKey(label) ?? "";
  const generic =
    nodeType === "symbol"
      ? GENERIC_SYMBOL_KEYS.has(key)
      : nodeType === "motif"
        ? GENERIC_MOTIF_KEYS.has(key)
        : false;

  if (nodeType === "symbol" || nodeType === "motif") {
    if (generic) {
      return {
        scope: "song_local",
        shouldInject: false
      };
    }

    return {
      scope: "canonical",
      shouldInject: true,
      stability: isMultiToken(label) ? 0.86 : 0.72
    };
  }

  return {
    scope: "canonical",
    shouldInject: true
  };
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

function withDeprecationMetadata(metadata, reason) {
  const next = isRecord(metadata) ? { ...metadata } : {};
  next.deprecatedBy = "phase1_reconciliation";
  next.deprecatedAt = new Date().toISOString();
  next.deprecationReason = reason;
  return next;
}

async function deactivateNodes(supabase, nodes, reason) {
  let count = 0;

  for (const node of nodes) {
    const { error } = await supabase
      .from("kg_nodes")
      .update({
        is_active: false,
        metadata: withDeprecationMetadata(node.metadata, reason),
        updated_at: new Date().toISOString()
      })
      .eq("id", node.id);

    if (error) {
      throw error;
    }

    count += 1;
  }

  return count;
}

async function deactivateEdges(supabase, edges, reason) {
  let count = 0;

  for (const edge of edges) {
    const { error } = await supabase
      .from("kg_edges")
      .update({
        is_active: false,
        metadata: withDeprecationMetadata(edge.metadata, reason),
        updated_at: new Date().toISOString()
      })
      .eq("id", edge.id);

    if (error) {
      throw error;
    }

    count += 1;
  }

  return count;
}

async function ensureCanonicalMotifNode(supabase, motifNode, canonicalMotif) {
  const { data: existing, error: readError } = await supabase
    .from("kg_nodes")
    .select("id, aliases, metadata")
    .eq("node_type", "motif")
    .eq("canonical_key", canonicalMotif.canonicalKey)
    .maybeSingle();

  if (readError) {
    throw readError;
  }

  const aliases = uniqStrings([
    canonicalMotif.displayLabel,
    canonicalMotif.sourceLabel,
    ...(existing ? asStringArray(existing.aliases) : []),
    motifNode.display_label
  ]);
  const metadata = {
    ...(isRecord(existing?.metadata) ? existing.metadata : {}),
    sourceLabels: uniqStrings([
      ...(isRecord(existing?.metadata) ? asStringArray(existing.metadata.sourceLabels) : []),
      canonicalMotif.sourceLabel,
      motifNode.display_label
    ])
  };

  const { data, error } = await supabase
    .from("kg_nodes")
    .upsert(
      {
        node_type: "motif",
        canonical_key: canonicalMotif.canonicalKey,
        display_label: canonicalMotif.displayLabel,
        aliases,
        metadata,
        is_active: true,
        updated_at: new Date().toISOString()
      },
      { onConflict: "node_type,canonical_key" }
    )
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data.id;
}

async function migrateMotifEdges(supabase, activeEdges, fromNodeId, toNodeId) {
  let migratedEdges = 0;
  let deprecatedEdges = 0;

  for (const edge of activeEdges) {
    if (edge.target_node_id !== fromNodeId) {
      continue;
    }

    const newEdgeKey = buildEdgeKey(edge.edge_type, edge.source_node_id, toNodeId, edge.source_song_id);
    const { error: upsertError } = await supabase
      .from("kg_edges")
      .upsert(
        {
          edge_key: newEdgeKey,
          edge_type: edge.edge_type,
          source_node_id: edge.source_node_id,
          target_node_id: toNodeId,
          source_song_id: edge.source_song_id,
          weight: edge.weight ?? 0.7,
          metadata: isRecord(edge.metadata) ? edge.metadata : {},
          evidence: asString(edge.evidence),
          is_active: true,
          updated_at: new Date().toISOString()
        },
        { onConflict: "edge_key" }
      );

    if (upsertError) {
      throw upsertError;
    }

    const { error: deactivateError } = await supabase
      .from("kg_edges")
      .update({
        is_active: false,
        metadata: withDeprecationMetadata(edge.metadata, `Motif edge migrated to canonical motif node ${toNodeId}.`),
        updated_at: new Date().toISOString()
      })
      .eq("id", edge.id);

    if (deactivateError) {
      throw deactivateError;
    }

    migratedEdges += 1;
    deprecatedEdges += 1;
  }

  return { migratedEdges, deprecatedEdges };
}

async function main() {
  const supabase = createClient(
    requiredAnyEnv(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );

  const [activeNodes, activeEdges, caches] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("kg_nodes")
        .select("id,node_type,canonical_key,display_label,metadata")
        .eq("is_active", true)
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("kg_edges")
        .select("id,edge_type,source_node_id,target_node_id,weight,metadata,source_song_id,evidence")
        .eq("is_active", true)
        .range(from, to)
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("memory_pack_cache")
        .select("id")
        .range(from, to),
      200
    )
  ]);

  const nodesById = new Map(activeNodes.map((node) => [node.id, node]));
  const artistNodes = activeNodes.filter((node) => node.node_type === "artist");
  const motifNodes = activeNodes.filter((node) => node.node_type === "motif");
  const symbolNodes = activeNodes.filter((node) => node.node_type === "symbol");

  const motifNodesToDeactivate = motifNodes.filter((node) => {
    const policy = evaluatePolicy("motif", node.display_label);
    return policy.scope === "song_local" || !policy.shouldInject;
  });

  const symbolNodesToDeactivate = symbolNodes.filter((node) => {
    const policy = evaluatePolicy("symbol", node.display_label);
    return policy.scope === "song_local" || !policy.shouldInject;
  });

  const deprecatedTargetNodeIds = new Set([
    ...motifNodesToDeactivate.map((node) => node.id),
    ...symbolNodesToDeactivate.map((node) => node.id)
  ]);

  const edgeIdsToDeprecate = new Set();
  const edgesToDeactivate = [];

  for (const edge of activeEdges) {
    if (deprecatedTargetNodeIds.has(edge.target_node_id)) {
      edgeIdsToDeprecate.add(edge.id);
      edgesToDeactivate.push(edge);
    }
  }

  const artistMotifEdgesToDeactivate = [];

  for (const edge of activeEdges) {
    if (edge.edge_type !== "artist_exhibits_motif" || edgeIdsToDeprecate.has(edge.id)) {
      continue;
    }

    const artistNode = nodesById.get(edge.source_node_id);
    const motifNode = nodesById.get(edge.target_node_id);

    if (!artistNode || !motifNode) {
      continue;
    }

    const recurringMotifKeys = new Set(
      asStringArray(isRecord(artistNode.metadata) ? artistNode.metadata.recurringMotifs : [])
        .map((value) => canonicalizeMotif(value)?.canonicalKey ?? normalizeKey(value))
        .filter(Boolean)
    );

    if (!recurringMotifKeys.has(motifNode.canonical_key)) {
      edgeIdsToDeprecate.add(edge.id);
      artistMotifEdgesToDeactivate.push(edge);
    }
  }

  const now = new Date().toISOString();
  let invalidatedCacheCount = 0;

  if (caches.length > 0) {
    const { error } = await supabase
      .from("memory_pack_cache")
      .update({
        version: 0,
        updated_at: now
      })
      .neq("version", -1);

    if (error) {
      throw error;
    }

    invalidatedCacheCount = caches.length;
  }

  const deactivatedNodeCount = await deactivateNodes(
    supabase,
    [...motifNodesToDeactivate, ...symbolNodesToDeactivate],
    "No longer canonical under hardened Phase 1 policy."
  );

  const deactivatedStructuralEdgeCount = await deactivateEdges(
    supabase,
    edgesToDeactivate,
    "Target node was deprecated by Phase 1 reconciliation."
  );

  const deactivatedArtistMotifEdgeCount = await deactivateEdges(
    supabase,
    artistMotifEdgesToDeactivate,
    "Artist motif edge no longer supported by artist recurring memory."
  );

  let mergedMotifNodeCount = 0;
  let migratedMotifEdgeCount = 0;

  for (const motifNode of motifNodes) {
    const canonicalMotif = canonicalizeMotif(motifNode.display_label);

    if (!canonicalMotif || canonicalMotif.canonicalKey === motifNode.canonical_key) {
      continue;
    }

    const canonicalNodeId = await ensureCanonicalMotifNode(supabase, motifNode, canonicalMotif);
    const migration = await migrateMotifEdges(supabase, activeEdges, motifNode.id, canonicalNodeId);

    const { error: deactivateNodeError } = await supabase
      .from("kg_nodes")
      .update({
        is_active: false,
        metadata: withDeprecationMetadata(
          motifNode.metadata,
          `Motif taxonomy reconciled into canonical family ${canonicalMotif.canonicalKey}.`
        ),
        updated_at: new Date().toISOString()
      })
      .eq("id", motifNode.id);

    if (deactivateNodeError) {
      throw deactivateNodeError;
    }

    mergedMotifNodeCount += 1;
    migratedMotifEdgeCount += migration.migratedEdges;
  }

  const report = {
    generatedAt: now,
    examined: {
      activeNodes: activeNodes.length,
      activeEdges: activeEdges.length,
      activeArtists: artistNodes.length,
      activeMotifs: motifNodes.length,
      activeSymbols: symbolNodes.length,
      memoryPackCaches: caches.length
    },
    deprecated: {
      motifNodes: motifNodesToDeactivate.length,
      symbolNodes: symbolNodesToDeactivate.length,
      nodesTotal: deactivatedNodeCount,
      structuralEdges: deactivatedStructuralEdgeCount,
      artistMotifEdges: deactivatedArtistMotifEdgeCount
    },
    taxonomy: {
      mergedMotifNodes: mergedMotifNodeCount,
      migratedMotifEdges: migratedMotifEdgeCount
    },
    invalidatedCaches: invalidatedCacheCount
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
