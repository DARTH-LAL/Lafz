"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
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

function NodeDetail({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const meta = node.metadata ?? {};
  return (
    <div
      className="flex flex-col gap-2 rounded-2xl p-4"
      style={{
        background: "rgba(6,2,5,0.94)",
        border: "1px solid rgba(255,20,100,0.40)",
        boxShadow: "0 0 32px rgba(255,20,100,0.25)"
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ background: node.color, boxShadow: `0 0 8px ${node.color}` }} />
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: node.color }}>
            {NODE_TYPE_LABELS[node.type] ?? node.type}
          </span>
        </div>
        <button onClick={onClose} className="text-[#8a7898] hover:text-white transition text-[16px] leading-none" aria-label="Close">×</button>
      </div>
      <p className="text-[15px] font-bold text-white leading-tight">{node.label}</p>
      {typeof meta.personaSummary === "string" && meta.personaSummary && (
        <p className="text-[12px] text-[#8a7898] leading-relaxed">{meta.personaSummary}</p>
      )}
      {typeof meta.meaning === "string" && meta.meaning && (
        <p className="text-[12px] text-[#8a7898]"><span className="text-white/40">meaning </span>{meta.meaning}</p>
      )}
      {typeof meta.note === "string" && meta.note && (
        <p className="text-[12px] text-[#8a7898]"><span className="text-white/40">note </span>{meta.note}</p>
      )}
      {typeof meta.role === "string" && meta.role && (
        <p className="text-[12px] text-[#8a7898]"><span className="text-white/40">role </span>{meta.role}</p>
      )}
      <span
        className="mt-1 self-start rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
        style={{
          background: node.confidence === "human_verified" ? "rgba(52,211,153,0.15)" : "rgba(255,20,100,0.10)",
          color: node.confidence === "human_verified" ? "#34d399" : "#ff6ba8",
          border: `1px solid ${node.confidence === "human_verified" ? "rgba(52,211,153,0.30)" : "rgba(255,20,100,0.25)"}`
        }}
      >
        {node.confidence?.replace(/_/g, " ") ?? "ai generated"}
      </span>
    </div>
  );
}

export function BrainFullscreen() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [graphKey, setGraphKey] = useState(0);
  const [dimensions, setDimensions] = useState({ width: 1280, height: 800 });

  const highlightNodes = useRef(new Set<string>());
  const highlightEdges = useRef(new Set<string>());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const bloomAdded = useRef(false);
  const initialFitDone = useRef(false);

  useEffect(() => {
    function measure() {
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
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
      highlightNodes.current = new Set();
      highlightEdges.current = new Set();
      setSelectedNode(null);
      setHoveredNode(null);
      setGraphData(data);
      setGraphKey(k => k + 1);
      initialFitDone.current = false;
      bloomAdded.current = false;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchGraph(); }, [fetchGraph]);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode((prev) => (prev?.id === node.id ? null : node));
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

  const handleNodeHover = useCallback((node: GraphNode | null) => setHoveredNode(node), []);

  const getNodeColor = useCallback((node: object) => {
    const n = node as GraphNode;
    return highlightNodes.current.has(n.id) || selectedNode?.id === n.id ? n.color : n.color + "cc";
  }, [selectedNode]);

  const getNodeVal = useCallback((node: object) => {
    const n = node as GraphNode;
    const base = n.type === "artist" ? 14 : n.type === "song" ? 8 : 4;
    return highlightNodes.current.has(n.id) || selectedNode?.id === n.id ? base * 1.6 : base;
  }, [selectedNode]);

  const getLinkColor = useCallback((edge: object) => {
    const e = edge as GraphEdge;
    const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source as string;
    const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target as string;
    return highlightEdges.current.has(`${sid}-${tid}`) ? "#ff6ba8" : "rgba(255,20,100,0.25)";
  }, []);

  const getLinkWidth = useCallback((edge: object) => {
    const e = edge as GraphEdge;
    const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source as string;
    const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target as string;
    return highlightEdges.current.has(`${sid}-${tid}`) ? (e.weight ?? 0.5) * 6 : 2;
  }, []);

  const activeNode = hoveredNode ?? selectedNode;
  const btnStyle = {
    background: "rgba(255,20,100,0.18)",
    border: "1px solid rgba(255,20,100,0.50)",
    boxShadow: "0 0 12px rgba(255,20,100,0.25)"
  };

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: "#000000" }}>
      {/* Full-viewport graph */}
      {!loading && !error && graphData && (() => {
        const nodeIds = new Set(graphData.nodes.map(n => n.id));
        const safeEdges = graphData.edges.filter(e => {
          const s = typeof e.source === "object" ? e.source.id : e.source;
          const t = typeof e.target === "object" ? e.target.id : e.target;
          return nodeIds.has(s) && nodeIds.has(t);
        });
        return (
        <ForceGraph3D
          key={graphKey}
          ref={fgRef}
          width={dimensions.width}
          height={dimensions.height}
          graphData={{ nodes: graphData.nodes as never[], links: safeEdges as never[] }}
          nodeId="id"
          linkSource="source"
          linkTarget="target"
          nodeColor={getNodeColor as never}
          nodeVal={getNodeVal as never}
          nodeLabel="label"
          nodeOpacity={0.92}
          linkColor={getLinkColor as never}
          linkWidth={getLinkWidth as never}
          linkOpacity={0.6}
          onNodeClick={handleNodeClick as never}
          onNodeHover={handleNodeHover as never}
          backgroundColor="#000000"
          linkDirectionalParticles={(edge) => {
            const e = edge as GraphEdge;
            const sid = typeof e.source === "object" ? (e.source as GraphNode).id : e.source as string;
            const tid = typeof e.target === "object" ? (e.target as GraphNode).id : e.target as string;
            return highlightEdges.current.has(`${sid}-${tid}`) ? 4 : 0;
          }}
          linkDirectionalParticleWidth={3}
          linkDirectionalParticleColor={() => "#ff6ba8"}
          cooldownTicks={150}
          d3AlphaDecay={0.04}
          d3VelocityDecay={0.6}
          onEngineStop={() => {
            if (!initialFitDone.current) {
              fgRef.current?.zoomToFit(400, 80);
              initialFitDone.current = true;
            }
            // Freeze all nodes in place so they don't flee on hover
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            graphData?.nodes.forEach((n: any) => { n.fx = n.x; n.fy = n.y; n.fz = n.z; });
            // Boost zoom speed
            try {
              const controls = fgRef.current?.controls();
              if (controls) controls.zoomSpeed = 3;
            } catch {}
            if (!bloomAdded.current) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const THREE = require("three");
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { UnrealBloomPass } = require("three/examples/jsm/postprocessing/UnrealBloomPass.js");
                const bloomPass = new UnrealBloomPass(new THREE.Vector2(dimensions.width, dimensions.height), 0.6, 0.4, 0.2);
                fgRef.current?.postProcessingComposer()?.addPass(bloomPass);
                bloomAdded.current = true;
              } catch {}
            }
          }}
        />
        );
      })()}

      {/* Loading overlay */}
      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="h-12 w-12 rounded-full border-2 border-[#ff1464] border-t-transparent animate-spin" style={{ boxShadow: "0 0 20px rgba(255,20,100,0.70)" }} />
            <span className="text-[13px] text-[#ff6ba8] font-semibold tracking-wide">Loading brain...</span>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 z-20 flex items-center justify-center">
          <p className="text-[14px] text-[#ff6ba8]">{error}</p>
        </div>
      )}

      {/* ── Floating top bar ── */}
      <div
        className="pointer-events-none absolute left-0 right-0 top-0 z-30 flex items-center justify-between px-5 py-4"
        style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.90) 0%, transparent 100%)" }}
      >
        {/* Wordmark + stats */}
        <div className="pointer-events-auto flex items-center gap-4">
          <span className="font-display text-[22px] font-extrabold tracking-[-1px] text-white">
            la
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: "linear-gradient(110deg,#ff1464 0%,#ff8ab0 22%,#ffffff 45%,#ff8ab0 68%,#ff1464 100%)",
                backgroundSize: "250% 100%",
                animation: "lafz-shimmer 3.5s linear infinite",
                filter: "drop-shadow(0 0 8px rgba(255,20,100,0.7))"
              }}
            >
              Fz Brain
            </span>
          </span>
          {graphData && (
            <div className="hidden items-center gap-2 sm:flex">
              <span className="rounded-full px-3 py-1 text-[11px] font-bold text-[#ff6ba8]" style={{ background: "rgba(6,2,5,0.92)", border: "1px solid rgba(255,20,100,0.45)", boxShadow: "0 0 10px rgba(255,20,100,0.25)" }}>
                {graphData.stats.nodeCount.toLocaleString()} nodes
              </span>
              <span className="rounded-full px-3 py-1 text-[11px] font-bold text-[#ff6ba8]" style={{ background: "rgba(6,2,5,0.92)", border: "1px solid rgba(255,20,100,0.45)", boxShadow: "0 0 10px rgba(255,20,100,0.25)" }}>
                {graphData.stats.edgeCount.toLocaleString()} edges
              </span>
            </div>
          )}
        </div>

        {/* Search + controls */}
        <div className="pointer-events-auto flex items-center gap-2">
          <input
            type="text"
            placeholder="Search nodes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchGraph(search || undefined, filterType ?? undefined)}
            className="h-9 rounded-xl px-3 text-[13px] text-white placeholder-white/60 outline-none transition"
            style={{ background: "rgba(6,2,5,0.85)", border: "1px solid rgba(255,20,100,0.35)", width: 200 }}
          />
          <button onClick={() => fetchGraph(search || undefined, filterType ?? undefined)} className="h-9 rounded-xl px-4 text-[12px] font-bold text-white transition hover:brightness-110" style={btnStyle}>
            Search
          </button>
          {(search || filterType) && (
            <button onClick={() => { setSearch(""); setFilterType(null); fetchGraph(); }} className="h-9 rounded-xl px-4 text-[12px] font-bold text-white transition hover:brightness-110" style={btnStyle}>
              Clear
            </button>
          )}
          <button
            onClick={() => setLegendOpen((v) => !v)}
            className="h-9 rounded-xl px-3 text-[12px] font-bold text-white transition hover:brightness-110"
            style={legendOpen ? { background: "rgba(255,20,100,0.28)", border: "1px solid rgba(255,20,100,0.70)", boxShadow: "0 0 14px rgba(255,20,100,0.40)" } : btnStyle}
          >
            Legend
          </button>
          <button onClick={() => window.close()} className="h-9 rounded-xl px-4 text-[12px] font-bold text-white transition hover:brightness-110" style={btnStyle}>
            ✕ Close
          </button>
        </div>
      </div>

      {/* ── Legend panel ── */}
      {legendOpen && (
        <div
          className="absolute right-5 top-[68px] z-30 flex flex-col gap-1.5 rounded-2xl p-4"
          style={{ background: "rgba(6,2,5,0.94)", border: "1px solid rgba(255,20,100,0.30)", boxShadow: "0 0 32px rgba(255,20,100,0.15)", minWidth: 170 }}
        >
          <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[#8a7898]">Node types</p>
          {NODE_TYPE_ORDER.map((type) => {
            const color = NODE_COLORS[type] ?? "#fff";
            const isActive = filterType === type;
            return (
              <button
                key={type}
                onClick={() => { const next = filterType === type ? null : type; setFilterType(next); fetchGraph(search || undefined, next ?? undefined); }}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition"
                style={{
                  background: isActive ? `${color}22` : `${color}08`,
                  border: isActive ? `1px solid ${color}88` : `1px solid ${color}33`,
                  boxShadow: isActive ? `0 0 12px ${color}55, inset 0 1px 0 ${color}25` : `0 0 6px ${color}22`
                }}
              >
                <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }} />
                <span className="text-[11px] font-medium" style={{ color: isActive ? color : color + "99", textShadow: isActive ? `0 0 8px ${color}` : "none" }}>
                  {NODE_TYPE_LABELS[type] ?? type}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── Node detail panel (bottom-left) ── */}
      {activeNode && (
        <div className="absolute bottom-6 left-5 z-30 w-72">
          <NodeDetail node={activeNode} onClose={() => { setSelectedNode(null); highlightNodes.current = new Set(); highlightEdges.current = new Set(); }} />
        </div>
      )}

      {/* ── Type filter pills (bottom centre) ── */}
      {graphData && Object.keys(graphData.stats.nodeTypeCounts).length > 0 && (
        <div className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 flex-wrap justify-center gap-1.5" style={{ maxWidth: "70vw" }}>
          {Object.entries(graphData.stats.nodeTypeCounts).map(([type, count]) => {
            const c = NODE_COLORS[type] ?? "#ff1464";
            const active = filterType === type;
            return (
              <button
                key={type}
                onClick={() => { const next = filterType === type ? null : type; setFilterType(next); fetchGraph(search || undefined, next ?? undefined); }}
                className="flex flex-col items-center gap-0.5 rounded-xl px-3 py-2 transition"
                style={{
                  background: active ? `${c}28` : "rgba(6,2,5,0.92)",
                  border: `1px solid ${active ? c : c + "55"}`,
                  boxShadow: active ? `0 0 0 1px ${c}22, 0 0 16px ${c}66, inset 0 1px 0 ${c}30` : `0 0 0 1px ${c}0a, 0 0 10px ${c}33, inset 0 1px 0 ${c}15`
                }}
              >
                <span className="text-[13px] font-bold" style={{ color: c, textShadow: active ? `0 0 10px ${c}` : `0 0 6px ${c}88` }}>{count}</span>
                <span className="text-[9px] uppercase tracking-widest font-semibold" style={{ color: active ? c : c + "99" }}>
                  {NODE_TYPE_LABELS[type] ?? type}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
