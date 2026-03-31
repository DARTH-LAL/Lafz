"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

const ForceGraph2D = dynamic(() => import("react-force-graph").then((mod) => mod.ForceGraph2D), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <span className="text-[#ff6ba8] text-sm animate-pulse">Loading brain...</span>
    </div>
  )
});

type GraphNode = {
  id: string;
  label: string;
  type: string;
  color: string;
  confidence: string;
  metadata: Record<string, unknown>;
  x?: number;
  y?: number;
};

type GraphEdge = {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  weight: number;
  evidence: string | null;
};

type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    nodeCount: number;
    edgeCount: number;
    nodeTypeCounts: Record<string, number>;
  };
};

const NODE_TYPE_LABELS: Record<string, string> = {
  artist: "Artist",
  song: "Song",
  term_surface: "Term",
  term_sense: "Sense",
  rendering: "Rendering",
  motif: "Motif",
  symbol: "Symbol",
  entity_instance: "Entity",
  entity_type: "Entity Type",
  persona_style: "Persona"
};

const NODE_TYPE_ORDER = [
  "artist", "song", "motif", "symbol", "term_surface",
  "term_sense", "rendering", "entity_instance", "entity_type", "persona_style"
];

function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      className="flex flex-col items-center gap-0.5 rounded-xl px-4 py-2"
      style={{
        background: "rgba(255,20,100,0.07)",
        border: "1px solid rgba(255,20,100,0.20)"
      }}
    >
      <span className="text-[18px] font-bold text-white" style={{ fontFamily: "var(--font-display)" }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-widest text-[#8a7898]">{label}</span>
    </div>
  );
}

function NodeDetail({ node }: { node: GraphNode | null }) {
  if (!node) return null;

  const meta = node.metadata ?? {};

  return (
    <div
      className="flex flex-col gap-2 rounded-2xl p-4"
      style={{
        background: "rgba(6,2,5,0.92)",
        border: "1px solid rgba(255,20,100,0.40)",
        boxShadow: "0 0 24px rgba(255,20,100,0.20)"
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-3 w-3 rounded-full flex-shrink-0"
          style={{ background: node.color, boxShadow: `0 0 8px ${node.color}` }}
        />
        <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: node.color }}>
          {NODE_TYPE_LABELS[node.type] ?? node.type}
        </span>
      </div>
      <p className="text-[15px] font-bold text-white leading-tight">{node.label}</p>

      {typeof meta.personaSummary === "string" && meta.personaSummary && (
        <p className="text-[12px] text-[#8a7898] leading-relaxed">{meta.personaSummary}</p>
      )}
      {typeof meta.meaning === "string" && meta.meaning && (
        <p className="text-[12px] text-[#8a7898]">
          <span className="text-white/40">meaning </span>{meta.meaning}
        </p>
      )}
      {typeof meta.note === "string" && meta.note && (
        <p className="text-[12px] text-[#8a7898]">
          <span className="text-white/40">note </span>{meta.note}
        </p>
      )}
      {typeof meta.role === "string" && meta.role && (
        <p className="text-[12px] text-[#8a7898]">
          <span className="text-white/40">role </span>{meta.role}
        </p>
      )}
      <div className="flex items-center gap-1.5 mt-1">
        <span
          className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
          style={{
            background: node.confidence === "human_verified" ? "rgba(52,211,153,0.15)" : "rgba(255,20,100,0.10)",
            color: node.confidence === "human_verified" ? "#34d399" : "#ff6ba8",
            border: `1px solid ${node.confidence === "human_verified" ? "rgba(52,211,153,0.30)" : "rgba(255,20,100,0.25)"}`
          }}
        >
          {node.confidence?.replace(/_/g, " ") ?? "ai generated"}
        </span>
      </div>
    </div>
  );
}

export function BrainClient() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);
  const highlightNodes = useRef(new Set<string>());
  const highlightEdges = useRef(new Set<string>());

  useEffect(() => {
    function measure() {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight
        });
      }
    }
    measure();
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const fetchGraph = useCallback(async (seed?: string, type?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "120" });
      if (seed) params.set("seed", seed);
      if (type) params.set("type", type);
      const res = await fetch(`/api/brain?${params}`);
      if (!res.ok) throw new Error("Failed to load brain data");
      const data = await res.json();
      setGraphData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
    highlightNodes.current = new Set([node.id]);
    highlightEdges.current = new Set();
    if (graphData) {
      for (const edge of graphData.edges) {
        const sourceId = typeof edge.source === "object" ? edge.source.id : edge.source;
        const targetId = typeof edge.target === "object" ? edge.target.id : edge.target;
        if (sourceId === node.id || targetId === node.id) {
          highlightEdges.current.add(`${sourceId}-${targetId}`);
          highlightNodes.current.add(sourceId);
          highlightNodes.current.add(targetId);
        }
      }
    }
  }, [graphData]);

  const handleNodeHover = useCallback((node: GraphNode | null) => {
    setHoveredNode(node);
  }, []);

  const paintNode = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const isHighlighted = highlightNodes.current.has(node.id);
      const isSelected = selectedNode?.id === node.id;
      const isHovered = hoveredNode?.id === node.id;
      const label = node.label ?? "";
      const baseRadius = node.type === "artist" ? 10 : node.type === "song" ? 7 : 5;
      const radius = isSelected ? baseRadius * 1.5 : isHighlighted ? baseRadius * 1.2 : baseRadius;

      // Glow
      if (isSelected || isHighlighted || isHovered) {
        ctx.save();
        ctx.shadowColor = node.color;
        ctx.shadowBlur = isSelected ? 24 : 14;
        ctx.beginPath();
        ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI);
        ctx.fillStyle = node.color + "44";
        ctx.fill();
        ctx.restore();
      }

      // Node circle
      ctx.save();
      ctx.shadowColor = node.color;
      ctx.shadowBlur = isSelected ? 16 : isHighlighted ? 8 : 4;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI);
      ctx.fillStyle = isSelected || isHighlighted ? node.color : node.color + "bb";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.restore();

      // Label
      if (globalScale > 1.2 || isSelected || isHighlighted || isHovered) {
        const fontSize = isSelected ? 5 : 3.5;
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgba(255,240,246,0.90)";
        ctx.fillText(label.length > 18 ? label.slice(0, 16) + "…" : label, node.x ?? 0, (node.y ?? 0) + radius + fontSize + 1);
      }
    },
    [selectedNode, hoveredNode]
  );

  const paintEdge = useCallback(
    (edge: GraphEdge, ctx: CanvasRenderingContext2D) => {
      const sourceId = typeof edge.source === "object" ? edge.source.id : edge.source;
      const targetId = typeof edge.target === "object" ? edge.target.id : edge.target;
      const isHighlighted = highlightEdges.current.has(`${sourceId}-${targetId}`);

      ctx.globalAlpha = isHighlighted ? 0.85 : 0.25;
      ctx.strokeStyle = isHighlighted ? "#ff6ba8" : "#ff146444";
      ctx.lineWidth = isHighlighted ? edge.weight * 2 : edge.weight * 0.8;
    },
    []
  );

  const activeNode = hoveredNode ?? selectedNode;

  return (
    <div className="flex flex-1 flex-col gap-4 min-h-0">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1
            className="text-[22px] font-extrabold tracking-[-0.5px] text-white"
            style={{ fontFamily: "var(--font-display)", textShadow: "0 0 18px rgba(255,20,100,0.40)" }}
          >
            la<span className="text-[#ff1464]" style={{ filter: "drop-shadow(0 0 8px rgba(255,20,100,0.8))" }}>F</span>z Brain
          </h1>
          <p className="text-[12px] text-[#8a7898] mt-0.5">Knowledge graph — every connection the brain has learned</p>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search nodes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchGraph(search || undefined, filterType ?? undefined)}
            className="h-9 rounded-xl px-3 text-[13px] text-white placeholder-[#8a7898] outline-none transition"
            style={{
              background: "rgba(6,2,5,0.80)",
              border: "1px solid rgba(255,20,100,0.30)",
              width: 180
            }}
          />
          <button
            onClick={() => fetchGraph(search || undefined, filterType ?? undefined)}
            className="h-9 rounded-xl px-4 text-[12px] font-bold text-white transition"
            style={{
              background: "rgba(255,20,100,0.18)",
              border: "1px solid rgba(255,20,100,0.50)",
              boxShadow: "0 0 12px rgba(255,20,100,0.25)"
            }}
          >
            Search
          </button>
          {(search || filterType) && (
            <button
              onClick={() => { setSearch(""); setFilterType(null); fetchGraph(); }}
              className="h-9 rounded-xl px-3 text-[12px] font-bold text-[#8a7898] transition hover:text-white"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      {graphData && (
        <div className="flex flex-wrap gap-2">
          <StatPill label="Total nodes" value={graphData.stats.nodeCount} />
          <StatPill label="Total edges" value={graphData.stats.edgeCount} />
          <StatPill label="Showing" value={graphData.nodes.length} />
          {Object.entries(graphData.stats.nodeTypeCounts).map(([type, count]) => (
            <button
              key={type}
              onClick={() => {
                const next = filterType === type ? null : type;
                setFilterType(next);
                fetchGraph(search || undefined, next ?? undefined);
              }}
              className="flex flex-col items-center gap-0.5 rounded-xl px-3 py-2 transition"
              style={{
                background: filterType === type ? "rgba(255,20,100,0.18)" : "rgba(255,255,255,0.03)",
                border: filterType === type ? "1px solid rgba(255,20,100,0.50)" : "1px solid rgba(255,255,255,0.08)",
                boxShadow: filterType === type ? "0 0 12px rgba(255,20,100,0.25)" : "none"
              }}
            >
              <span className="text-[13px] font-bold text-white">{count}</span>
              <span className="text-[9px] uppercase tracking-widest font-semibold text-[#8a7898]">
                {NODE_TYPE_LABELS[type] ?? type}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Graph + detail */}
      <div className="flex flex-1 gap-4 min-h-0" style={{ minHeight: 500 }}>
        {/* Graph canvas */}
        <div
          ref={containerRef}
          className="flex-1 rounded-2xl overflow-hidden relative"
          style={{
            background: "rgba(6,2,5,0.85)",
            border: "1px solid rgba(255,20,100,0.25)",
            boxShadow: "0 0 40px rgba(255,20,100,0.10), inset 0 1px 0 rgba(255,20,100,0.12)"
          }}
        >
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div
                  className="h-10 w-10 rounded-full border-2 border-[#ff1464] border-t-transparent animate-spin"
                  style={{ boxShadow: "0 0 16px rgba(255,20,100,0.60)" }}
                />
                <span className="text-[12px] text-[#ff6ba8] font-semibold">Loading brain...</span>
              </div>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <p className="text-[13px] text-[#ff6ba8]">{error}</p>
            </div>
          )}

          {!loading && !error && graphData && (
            <ForceGraph2D
              width={dimensions.width}
              height={dimensions.height}
              graphData={{ nodes: graphData.nodes as never[], links: graphData.edges as never[] }}
              nodeId="id"
              linkSource="source"
              linkTarget="target"
              nodeCanvasObject={paintNode as never}
              linkCanvasObjectMode={() => "replace"}
              linkCanvasObject={paintEdge as never}
              onNodeClick={handleNodeClick as never}
              onNodeHover={handleNodeHover as never}
              backgroundColor="transparent"
              linkDirectionalParticles={2}
              linkDirectionalParticleWidth={(edge) => {
                const sourceId = typeof (edge as GraphEdge).source === "object"
                  ? ((edge as GraphEdge).source as GraphNode).id
                  : (edge as GraphEdge).source as string;
                const targetId = typeof (edge as GraphEdge).target === "object"
                  ? ((edge as GraphEdge).target as GraphNode).id
                  : (edge as GraphEdge).target as string;
                return highlightEdges.current.has(`${sourceId}-${targetId}`) ? 2 : 0;
              }}
              linkDirectionalParticleColor={() => "#ff6ba8"}
              cooldownTicks={80}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
            />
          )}

          {!loading && !error && graphData?.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-[13px] text-[#8a7898]">No nodes found — try a different search</p>
            </div>
          )}
        </div>

        {/* Node detail panel */}
        <div className="flex w-64 flex-shrink-0 flex-col gap-3">
          <NodeDetail node={activeNode} />

          {!activeNode && (
            <div
              className="rounded-2xl p-4 text-center"
              style={{
                background: "rgba(6,2,5,0.85)",
                border: "1px solid rgba(255,255,255,0.06)"
              }}
            >
              <p className="text-[12px] text-[#8a7898]">Click any node to explore its connections</p>
            </div>
          )}

          {/* Legend */}
          <div
            className="rounded-2xl p-4 flex flex-col gap-2"
            style={{
              background: "rgba(6,2,5,0.85)",
              border: "1px solid rgba(255,255,255,0.06)"
            }}
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a7898] mb-1">Node types</p>
            {NODE_TYPE_ORDER.map((type) => (
              <button
                key={type}
                onClick={() => {
                  const next = filterType === type ? null : type;
                  setFilterType(next);
                  fetchGraph(search || undefined, next ?? undefined);
                }}
                className="flex items-center gap-2 rounded-lg px-2 py-1 transition hover:bg-white/5"
              >
                <span
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                  style={{
                    background: Object.entries(NODE_TYPE_LABELS).find(([k]) => k === type)?.[0]
                      ? "#ff1464"
                      : "#fff",
                    backgroundColor: (() => {
                      const colors: Record<string, string> = {
                        artist: "#ff1464", song: "#ff6ba8", term_surface: "#ff8c42",
                        term_sense: "#ffb347", rendering: "#c084fc", motif: "#38bdf8",
                        symbol: "#34d399", entity_instance: "#f472b6",
                        entity_type: "#fb7185", persona_style: "#a78bfa"
                      };
                      return colors[type] ?? "#fff";
                    })(),
                    boxShadow: (() => {
                      const colors: Record<string, string> = {
                        artist: "#ff1464", song: "#ff6ba8", term_surface: "#ff8c42",
                        term_sense: "#ffb347", rendering: "#c084fc", motif: "#38bdf8",
                        symbol: "#34d399", entity_instance: "#f472b6",
                        entity_type: "#fb7185", persona_style: "#a78bfa"
                      };
                      return `0 0 6px ${colors[type] ?? "#fff"}`;
                    })()
                  }}
                />
                <span className={`text-[11px] font-medium ${filterType === type ? "text-white" : "text-[#8a7898]"}`}>
                  {NODE_TYPE_LABELS[type] ?? type}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
