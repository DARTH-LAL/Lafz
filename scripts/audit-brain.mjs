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

const GENERIC_SYMBOL_KEYS = new Set(["eyes", "eye", "heart", "mind", "world", "dream", "dreams", "night", "nights", "pain", "tears", "smile"]);
const GENERIC_MOTIF_KEYS = new Set(["love", "romance", "sadness", "emotion", "feelings", "beauty", "memory", "memories"]);

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

function average(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function main() {
  const supabaseUrl = requiredAnyEnv(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const supabaseServiceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false }
  });

  const [nodes, edges, packs] = await Promise.all([
    fetchAllRows((from, to) => supabase.from("kg_nodes").select("id,node_type,canonical_key,display_label,metadata,is_active").eq("is_active", true).range(from, to)),
    fetchAllRows((from, to) => supabase.from("kg_edges").select("id,edge_type,weight,is_active").eq("is_active", true).range(from, to)),
    fetchAllRows((from, to) => supabase.from("memory_pack_cache").select("cache_key,payload_json,updated_at").range(from, to), 200)
  ]);

  const nodeTypeCounts = Object.fromEntries(
    Object.entries(nodes.reduce((acc, node) => {
      acc[node.node_type] = (acc[node.node_type] ?? 0) + 1;
      return acc;
    }, {})).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  );

  const edgeTypeCounts = Object.fromEntries(
    Object.entries(edges.reduce((acc, edge) => {
      acc[edge.edge_type] = (acc[edge.edge_type] ?? 0) + 1;
      return acc;
    }, {})).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  );

  const duplicateBuckets = new Map();
  for (const node of nodes) {
    const normalized = normalizeKey(node.display_label);
    if (!normalized) continue;
    const bucketKey = `${node.node_type}::${normalized}`;
    const bucket = duplicateBuckets.get(bucketKey) ?? [];
    bucket.push({ id: node.id, label: node.display_label, canonicalKey: node.canonical_key });
    duplicateBuckets.set(bucketKey, bucket);
  }

  const duplicates = Array.from(duplicateBuckets.entries())
    .filter(([, bucket]) => bucket.length > 1)
    .slice(0, 25)
    .map(([bucketKey, bucket]) => ({ bucketKey, count: bucket.length, examples: bucket.slice(0, 4) }));

  const lowSignalSymbols = nodes
    .filter((node) => node.node_type === "symbol" && GENERIC_SYMBOL_KEYS.has(normalizeKey(node.display_label) ?? ""))
    .slice(0, 20)
    .map((node) => ({ id: node.id, label: node.display_label, canonicalKey: node.canonical_key }));

  const lowSignalMotifs = nodes
    .filter((node) => node.node_type === "motif" && GENERIC_MOTIF_KEYS.has(normalizeKey(node.display_label) ?? ""))
    .slice(0, 20)
    .map((node) => ({ id: node.id, label: node.display_label, canonicalKey: node.canonical_key }));

  const packStats = packs.map((row) => {
    const payload = row.payload_json ?? {};
    return {
      cacheKey: row.cache_key,
      sourceSongCount: Array.isArray(payload.sourceSongIds) ? payload.sourceSongIds.length : 0,
      styleCount: Array.isArray(payload.styleHints) ? payload.styleHints.length : 0,
      motifCount: Array.isArray(payload.motifHints) ? payload.motifHints.length : 0,
      relationshipCount: Array.isArray(payload.relationshipPriors) ? payload.relationshipPriors.length : 0,
      symbolCount: Array.isArray(payload.symbolHints) ? payload.symbolHints.length : 0,
      renderingCount: Array.isArray(payload.renderingHints) ? payload.renderingHints.length : 0,
      filteredCounts: payload.audit?.filteredCounts ?? null,
      updatedAt: row.updated_at
    };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      nodes: nodes.length,
      edges: edges.length,
      memoryPacks: packs.length
    },
    nodeTypeCounts,
    edgeTypeCounts,
    duplicates,
    lowSignal: {
      symbols: lowSignalSymbols,
      motifs: lowSignalMotifs
    },
    memoryPackHealth: {
      averageSourceSongs: Number(average(packStats.map((entry) => entry.sourceSongCount)).toFixed(2)),
      averageStyleHints: Number(average(packStats.map((entry) => entry.styleCount)).toFixed(2)),
      averageMotifHints: Number(average(packStats.map((entry) => entry.motifCount)).toFixed(2)),
      averageRelationshipPriors: Number(average(packStats.map((entry) => entry.relationshipCount)).toFixed(2)),
      averageSymbolHints: Number(average(packStats.map((entry) => entry.symbolCount)).toFixed(2)),
      averageRenderingHints: Number(average(packStats.map((entry) => entry.renderingCount)).toFixed(2)),
      topLargePacks: [...packStats]
        .sort((left, right) => (right.styleCount + right.motifCount + right.relationshipCount + right.symbolCount + right.renderingCount) - (left.styleCount + left.motifCount + left.relationshipCount + left.symbolCount + left.renderingCount))
        .slice(0, 10),
      filteredExamples: packStats.filter((entry) => entry.filteredCounts && Object.values(entry.filteredCounts).some((value) => Number(value) > 0)).slice(0, 10)
    }
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
