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

export async function GET(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });

  const seed = request.nextUrl.searchParams.get("seed") ?? null;
  const nodeType = request.nextUrl.searchParams.get("type") ?? null;
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") ?? "120"), 300);

  try {
    let nodesQuery = supabase
      .from("kg_nodes")
      .select("id, node_type, canonical_key, display_label, metadata, source_confidence")
      .eq("is_active", true)
      .limit(limit);

    if (nodeType) {
      nodesQuery = nodesQuery.eq("node_type", nodeType);
    } else if (seed) {
      nodesQuery = nodesQuery.or(`canonical_key.ilike.%${seed}%,display_label.ilike.%${seed}%`);
    }

    const { data: nodes, error: nodesError } = await nodesQuery;
    if (nodesError) throw nodesError;

    if (!nodes || nodes.length === 0) {
      return NextResponse.json({ nodes: [], edges: [], stats: { nodeCount: 0, edgeCount: 0 } });
    }

    const nodeIds = nodes.map((n) => n.id);

    const { data: edges, error: edgesError } = await supabase
      .from("kg_edges")
      .select("id, edge_type, source_node_id, target_node_id, weight, metadata, evidence")
      .eq("is_active", true)
      .in("source_node_id", nodeIds)
      .in("target_node_id", nodeIds)
      .limit(500);

    if (edgesError) throw edgesError;

    const graphNodes = (nodes ?? []).map((node) => ({
      id: node.id,
      label: node.display_label,
      type: node.node_type,
      color: NODE_COLORS[node.node_type] ?? "#ffffff",
      confidence: node.source_confidence,
      metadata: node.metadata
    }));

    const graphEdges = (edges ?? []).map((edge) => ({
      source: edge.source_node_id,
      target: edge.target_node_id,
      type: edge.edge_type,
      weight: edge.weight ?? 0.5,
      evidence: edge.evidence,
      metadata: edge.metadata
    }));

    const { count: totalNodes } = await supabase
      .from("kg_nodes")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true);

    const { count: totalEdges } = await supabase
      .from("kg_edges")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true);

    const nodeTypeCounts: Record<string, number> = {};
    for (const node of nodes) {
      nodeTypeCounts[node.node_type] = (nodeTypeCounts[node.node_type] ?? 0) + 1;
    }

    return NextResponse.json({
      nodes: graphNodes,
      edges: graphEdges,
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
