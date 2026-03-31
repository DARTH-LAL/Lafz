import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/features/cloud/supabase";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NODE_COLORS: Record<string, string> = {
  artist: "#ff1464",
  song: "#ff6ba8",
  term_surface: "#ff8c42",
  term_sense: "#ffb347",
  rendering: "#c084fc",
  motif: "#38bdf8",
  symbol: "#34d399",
  entity_instance: "#f472b6",
  entity_type: "#fb7185",
  persona_style: "#a78bfa"
};

// How many nodes to fetch per type when showing the full graph
const TYPE_LIMITS: Record<string, number> = {
  artist: 20,
  song: 30,
  motif: 20,
  symbol: 15,
  term_surface: 20,
  term_sense: 15,
  rendering: 10,
  entity_instance: 15,
  entity_type: 10,
  persona_style: 10
};

export async function GET(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const seed = request.nextUrl.searchParams.get("seed") ?? null;
  const nodeType = request.nextUrl.searchParams.get("type") ?? null;

  try {
    let seedNodes: { id: string; node_type: string; canonical_key: string; display_label: string; metadata: Record<string, unknown>; source_confidence: string }[] = [];

    if (seed) {
      // Search mode — find matching nodes
      const { data } = await supabase
        .from("kg_nodes")
        .select("id, node_type, canonical_key, display_label, metadata, source_confidence")
        .eq("is_active", true)
        .or(`canonical_key.ilike.%${seed}%,display_label.ilike.%${seed}%`)
        .limit(60);
      seedNodes = data ?? [];
    } else if (nodeType) {
      // Single type filter
      const { data } = await supabase
        .from("kg_nodes")
        .select("id, node_type, canonical_key, display_label, metadata, source_confidence")
        .eq("is_active", true)
        .eq("node_type", nodeType)
        .limit(80);
      seedNodes = data ?? [];
    } else {
      // Default: fetch a spread across all node types
      const batches = await Promise.all(
        Object.entries(TYPE_LIMITS).map(([type, limit]) =>
          supabase
            .from("kg_nodes")
            .select("id, node_type, canonical_key, display_label, metadata, source_confidence")
            .eq("is_active", true)
            .eq("node_type", type)
            .limit(limit)
            .then(({ data }) => data ?? [])
        )
      );
      seedNodes = batches.flat();
    }

    if (seedNodes.length === 0) {
      return NextResponse.json({ nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0, nodeTypeCounts: {} } });
    }

    const seedNodeIds = seedNodes.map((n) => n.id);

    // Fetch edges where source is in our seed set
    const { data: outEdges } = await supabase
      .from("kg_edges")
      .select("id, edge_type, source_node_id, target_node_id, weight, metadata, evidence")
      .eq("is_active", true)
      .in("source_node_id", seedNodeIds)
      .limit(600);

    // Fetch edges where target is in our seed set
    const { data: inEdges } = await supabase
      .from("kg_edges")
      .select("id, edge_type, source_node_id, target_node_id, weight, metadata, evidence")
      .eq("is_active", true)
      .in("target_node_id", seedNodeIds)
      .limit(600);

    const allEdges = [
      ...(outEdges ?? []),
      ...(inEdges ?? [])
    ].filter((edge, index, self) =>
      index === self.findIndex((e) => e.id === edge.id)
    );

    // Collect any node IDs referenced in edges that aren't already in our set
    const seedIdSet = new Set(seedNodeIds);
    const extraIds = Array.from(
      new Set(
        allEdges.flatMap((e) => [e.source_node_id, e.target_node_id])
          .filter((id) => !seedIdSet.has(id))
      )
    );

    // Fetch the extra nodes so edges render correctly
    let extraNodes: typeof seedNodes = [];
    if (extraIds.length > 0) {
      const { data } = await supabase
        .from("kg_nodes")
        .select("id, node_type, canonical_key, display_label, metadata, source_confidence")
        .in("id", extraIds.slice(0, 200));
      extraNodes = data ?? [];
    }

    const allNodes = [...seedNodes, ...extraNodes];

    // Stats
    const { count: totalNodes } = await supabase
      .from("kg_nodes")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true);

    const { count: totalEdges } = await supabase
      .from("kg_edges")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true);

    const nodeTypeCounts: Record<string, number> = {};
    for (const node of seedNodes) {
      nodeTypeCounts[node.node_type] = (nodeTypeCounts[node.node_type] ?? 0) + 1;
    }

    return NextResponse.json({
      nodes: allNodes.map((node) => ({
        id: node.id,
        label: node.display_label,
        type: node.node_type,
        color: NODE_COLORS[node.node_type] ?? "#ffffff",
        confidence: node.source_confidence,
        metadata: node.metadata
      })),
      edges: allEdges.map((edge) => ({
        source: edge.source_node_id,
        target: edge.target_node_id,
        type: edge.edge_type,
        weight: edge.weight ?? 0.5,
        evidence: edge.evidence,
        metadata: edge.metadata
      })),
      stats: {
        nodeCount: totalNodes ?? 0,
        edgeCount: totalEdges ?? 0,
        nodeTypeCounts
      }
    });
  } catch (error) {
    console.error("Brain graph API error:", error);
    return NextResponse.json({ error: "Failed to load brain graph" }, { status: 500 });
  }
}
