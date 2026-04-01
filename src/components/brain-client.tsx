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

type MemoryPackTextHint = {
  value: string;
  score: number;
  confidence: string;
  reasons: string[];
};

type MemoryPackSymbolHint = {
  symbol: string;
  score: number;
  confidence: string;
  frequency: number;
  reasons: string[];
};

type MemoryPackRenderingHint = {
  term: string;
  meaning: string;
  score: number;
  confidence: string;
  reasons: string[];
};

type MemoryPackData = {
  spotifyTrackId: string;
  artist: string;
  cachedAt: string | null;
  pack: {
    sourceSongIds: string[];
    styleHintDetails: MemoryPackTextHint[];
    motifHintDetails: MemoryPackTextHint[];
    relationshipPriorDetails: MemoryPackTextHint[];
    symbolHints: MemoryPackSymbolHint[];
    renderingHints: MemoryPackRenderingHint[];
    audit: {
      sourceSongIdsCount: number;
      candidateTextCount: number;
      filteredCounts: Record<string, number>;
      appliedRules: string[];
    };
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

function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      className="flex flex-col items-center gap-0.5 rounded-xl px-4 py-2"
      style={{
        background: "rgba(6,2,5,0.92)",
        border: "1px solid rgba(255,20,100,0.45)",
        boxShadow: "0 0 0 1px rgba(255,20,100,0.10), 0 0 14px rgba(255,20,100,0.30), inset 0 1px 0 rgba(255,20,100,0.12)"
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

function RetrievalSection({ title, items }: { title: string; items: Array<{ label: string; score: number; subtitle?: string }> }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a7898]">{title}</p>
      <div className="flex flex-col gap-1.5">
        {items.map((item) => (
          <div
            key={`${title}-${item.label}`}
            className="rounded-xl px-3 py-2"
            style={{
              background: "rgba(15,8,12,0.9)",
              border: "1px solid rgba(255,20,100,0.16)"
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <span className="text-[12px] font-semibold text-white leading-snug">{item.label}</span>
              <span className="text-[10px] font-bold text-[#ff6ba8]">{item.score.toFixed(2)}</span>
            </div>
            {item.subtitle && <p className="mt-1 text-[11px] text-[#8a7898] leading-snug">{item.subtitle}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function MemoryPackPanel({
  memoryPack,
  loading
}: {
  memoryPack: MemoryPackData | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div
        className="rounded-2xl p-4"
        style={{
          background: "rgba(6,2,5,0.92)",
          border: "1px solid rgba(255,20,100,0.20)",
          boxShadow: "0 0 12px rgba(255,20,100,0.10)"
        }}
      >
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a7898]">Retrieval</p>
        <p className="mt-2 text-[12px] text-[#ff6ba8]">Loading memory pack…</p>
      </div>
    );
  }

  if (!memoryPack) {
    return null;
  }

  const topStyle = memoryPack.pack.styleHintDetails.slice(0, 3).map((item) => ({
    label: item.value,
    score: item.score,
    subtitle: item.reasons[0]
  }));
  const topMotifs = memoryPack.pack.motifHintDetails.slice(0, 3).map((item) => ({
    label: item.value,
    score: item.score,
    subtitle: item.reasons[0]
  }));
  const topRelationships = memoryPack.pack.relationshipPriorDetails.slice(0, 3).map((item) => ({
    label: item.value,
    score: item.score,
    subtitle: item.reasons[0]
  }));
  const topSymbols = memoryPack.pack.symbolHints.slice(0, 3).map((item) => ({
    label: item.symbol,
    score: item.score,
    subtitle: `${item.frequency} prior song${item.frequency === 1 ? "" : "s"}`
  }));
  const topRenderings = memoryPack.pack.renderingHints.slice(0, 4).map((item) => ({
    label: `${item.term} -> ${item.meaning}`,
    score: item.score,
    subtitle: item.reasons[0]
  }));

  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{
        background: "rgba(6,2,5,0.92)",
        border: "1px solid rgba(255,20,100,0.20)",
        boxShadow: "0 0 12px rgba(255,20,100,0.10)"
      }}
    >
      <div className="flex flex-col gap-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a7898]">Retrieval</p>
        <p className="text-[12px] text-white font-semibold">{memoryPack.artist}</p>
        <p className="text-[11px] text-[#8a7898]">
          {memoryPack.pack.audit.sourceSongIdsCount} source song{memoryPack.pack.audit.sourceSongIdsCount === 1 ? "" : "s"}
          {memoryPack.cachedAt ? ` • cached ${new Date(memoryPack.cachedAt).toLocaleString()}` : ""}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {memoryPack.pack.audit.appliedRules.map((rule) => (
          <span
            key={rule}
            className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
            style={{
              background: "rgba(255,20,100,0.10)",
              color: "#ff6ba8",
              border: "1px solid rgba(255,20,100,0.20)"
            }}
          >
            {rule}
          </span>
        ))}
      </div>

      <RetrievalSection title="Style" items={topStyle} />
      <RetrievalSection title="Motifs" items={topMotifs} />
      <RetrievalSection title="Relationships" items={topRelationships} />
      <RetrievalSection title="Symbols" items={topSymbols} />
      <RetrievalSection title="Renderings" items={topRenderings} />
    </div>
  );
}

export function BrainClient() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [memoryPack, setMemoryPack] = useState<MemoryPackData | null>(null);
  const [memoryPackLoading, setMemoryPackLoading] = useState(false);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [graphKey, setGraphKey] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const highlightNodes = useRef(new Set<string>());
  const highlightEdges = useRef(new Set<string>());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const bloomAdded = useRef(false);
  const initialFitDone = useRef(false);

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
      // Clear stale node references before swapping in new data
      highlightNodes.current = new Set();
      highlightEdges.current = new Set();
      setSelectedNode(null);
      setHoveredNode(null);
      setGraphData(data);
      // Increment key to fully remount ForceGraph3D — prevents stale internal Three.js refs
      setGraphKey(k => k + 1);
      initialFitDone.current = false;
      bloomAdded.current = false;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGraph();
  }, [fetchGraph]);

  useEffect(() => {
    const spotifyTrackId =
      selectedNode?.type === "song" && typeof selectedNode.metadata.spotifyTrackId === "string"
        ? selectedNode.metadata.spotifyTrackId
        : null;
    const artist =
      selectedNode?.type === "song" && typeof selectedNode.metadata.artist === "string"
        ? selectedNode.metadata.artist
        : null;

    if (!spotifyTrackId || !artist) {
      setMemoryPack(null);
      setMemoryPackLoading(false);
      return;
    }

    const resolvedSpotifyTrackId = spotifyTrackId;
    const resolvedArtist = artist;

    let cancelled = false;

    async function fetchMemoryPack() {
      setMemoryPackLoading(true);

      try {
        const params = new URLSearchParams();
        params.set("mode", "memory-pack");
        params.set("spotifyTrackId", resolvedSpotifyTrackId);
        params.set("artist", resolvedArtist);
        const res = await fetch(`/api/brain?${params}`);

        if (!res.ok) {
          throw new Error("Failed to load memory pack");
        }

        const data = await res.json();

        if (!cancelled) {
          setMemoryPack(data);
        }
      } catch {
        if (!cancelled) {
          setMemoryPack(null);
        }
      } finally {
        if (!cancelled) {
          setMemoryPackLoading(false);
        }
      }
    }

    fetchMemoryPack();

    return () => {
      cancelled = true;
    };
  }, [selectedNode]);

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

  const handleNodeHover = useCallback((node: GraphNode | null) => {
    setHoveredNode(node);
  }, []);

  const getNodeColor = useCallback((node: object) => {
    const n = node as GraphNode;
    const isHighlighted = highlightNodes.current.has(n.id);
    const isSelected = selectedNode?.id === n.id;
    return isSelected || isHighlighted ? n.color : n.color + "cc";
  }, [selectedNode]);

  const getNodeVal = useCallback((node: object) => {
    const n = node as GraphNode;
    const base = n.type === "artist" ? 12 : n.type === "song" ? 7 : 4;
    return highlightNodes.current.has(n.id) || selectedNode?.id === n.id ? base * 1.6 : base;
  }, [selectedNode]);

  const getLinkColor = useCallback((edge: object) => {
    const e = edge as GraphEdge;
    const sourceId = typeof e.source === "object" ? (e.source as GraphNode).id : e.source as string;
    const targetId = typeof e.target === "object" ? (e.target as GraphNode).id : e.target as string;
    return highlightEdges.current.has(`${sourceId}-${targetId}`) ? "#ff6ba8" : "rgba(255,20,100,0.25)";
  }, []);

  const getLinkWidth = useCallback((edge: object) => {
    const e = edge as GraphEdge;
    const sourceId = typeof e.source === "object" ? (e.source as GraphNode).id : e.source as string;
    const targetId = typeof e.target === "object" ? (e.target as GraphNode).id : e.target as string;
    return highlightEdges.current.has(`${sourceId}-${targetId}`) ? (e.weight ?? 0.5) * 6 : 2;
  }, []);

  const activeNode = hoveredNode ?? selectedNode;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <header className="mb-8 pb-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="h-0.5 w-7 rounded-full bg-[linear-gradient(90deg,#ff1464,transparent)] shadow-[0_0_8px_#ff1464]" />
          <p className="text-[11px] font-bold uppercase tracking-[2.5px] text-[#ff1464] [text-shadow:0_0_16px_rgba(255,20,100,0.6)]">
            Knowledge Graph
          </p>
        </div>
        <h1 className="font-display text-5xl font-extrabold leading-[1.04] tracking-[-2.2px] text-white [text-shadow:0_0_30px_rgba(255,255,255,0.30),0_0_70px_rgba(255,255,255,0.12)]">
          la
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage: "linear-gradient(110deg,#ff1464 0%,#ff8ab0 22%,#ffffff 45%,#ff8ab0 68%,#ff1464 100%)",
              backgroundSize: "250% 100%",
              animation: "lafz-shimmer 3.5s linear infinite",
              filter: "drop-shadow(0 0 18px rgba(255,20,100,0.55))"
            }}
          >
            Fz Brain
          </span>
        </h1>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Search nodes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && fetchGraph(search || undefined, filterType ?? undefined)}
            className="h-9 rounded-xl px-3 text-[13px] text-white placeholder-white/60 outline-none transition"
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
              className="h-9 rounded-xl px-4 text-[12px] font-bold text-white transition hover:brightness-110"
              style={{
                background: "rgba(255,20,100,0.18)",
                border: "1px solid rgba(255,20,100,0.50)",
                boxShadow: "0 0 12px rgba(255,20,100,0.25)"
              }}
            >
              Clear
            </button>
          )}
          <a
            href="/brain/fullscreen"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12px] font-bold text-white transition hover:brightness-110"
            style={{
              background: "rgba(255,20,100,0.18)",
              border: "1px solid rgba(255,20,100,0.50)",
              boxShadow: "0 0 12px rgba(255,20,100,0.25)"
            }}
            title="Open fullscreen"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
            Fullscreen
          </a>
        </div>
      </header>

      {/* Stats */}
      {graphData && (
        <div className="flex flex-wrap gap-2">
          <StatPill label="Total nodes" value={graphData.stats.nodeCount} />
          <StatPill label="Total edges" value={graphData.stats.edgeCount} />
          <StatPill label="Showing" value={graphData.nodes.length} />
          {Object.entries(graphData.stats.nodeTypeCounts).map(([type, count]) => {
            const c = NODE_COLORS[type] ?? "#ff1464";
            const active = filterType === type;
            return (
              <button
                key={type}
                onClick={() => {
                  const next = filterType === type ? null : type;
                  setFilterType(next);
                  fetchGraph(search || undefined, next ?? undefined);
                }}
                className="flex flex-col items-center gap-0.5 rounded-xl px-3 py-2 transition"
                style={{
                  background: active ? `${c}28` : "rgba(6,2,5,0.92)",
                  border: `1px solid ${active ? c : c + "55"}`,
                  boxShadow: active
                    ? `0 0 0 1px ${c}22, 0 0 16px ${c}66, inset 0 1px 0 ${c}30`
                    : `0 0 0 1px ${c}0a, 0 0 10px ${c}33, inset 0 1px 0 ${c}15`
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

      {/* Graph + detail */}
      <div className="flex gap-4" style={{ height: 560 }}>
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
                const sourceId = typeof e.source === "object" ? (e.source as GraphNode).id : e.source as string;
                const targetId = typeof e.target === "object" ? (e.target as GraphNode).id : e.target as string;
                return highlightEdges.current.has(`${sourceId}-${targetId}`) ? 4 : 0;
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
                // Add bloom glow effect once
                if (!bloomAdded.current) {
                  try {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const THREE = require("three");
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const { UnrealBloomPass } = require("three/examples/jsm/postprocessing/UnrealBloomPass.js");
                    const bloomPass = new UnrealBloomPass(
                      new THREE.Vector2(dimensions.width, dimensions.height),
                      0.6,
                      0.4,
                      0.2
                    );
                    fgRef.current?.postProcessingComposer()?.addPass(bloomPass);
                    bloomAdded.current = true;
                  } catch {}
                }
              }}
            />
            );
          })()}

          {!loading && !error && graphData?.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-[13px] text-[#8a7898]">No nodes found — try a different search</p>
            </div>
          )}
        </div>

        {/* Node detail panel */}
        <div className="flex w-64 flex-shrink-0 flex-col gap-3">
          <NodeDetail node={activeNode} />
          <MemoryPackPanel memoryPack={memoryPack} loading={memoryPackLoading} />


          {/* Legend */}
          <div
            className="rounded-2xl p-4 flex flex-col gap-1.5"
            style={{
              background: "rgba(6,2,5,0.92)",
              border: "1px solid rgba(255,20,100,0.20)",
              boxShadow: "0 0 12px rgba(255,20,100,0.10)"
            }}
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a7898] mb-2">Node types</p>
            {NODE_TYPE_ORDER.map((type) => {
              const color = NODE_COLORS[type] ?? "#fff";
              const isActive = filterType === type;
              return (
                <button
                  key={type}
                  onClick={() => {
                    const next = filterType === type ? null : type;
                    setFilterType(next);
                    fetchGraph(search || undefined, next ?? undefined);
                  }}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition"
                  style={{
                    background: isActive ? `${color}22` : `${color}08`,
                    border: isActive ? `1px solid ${color}88` : `1px solid ${color}33`,
                    boxShadow: isActive ? `0 0 12px ${color}55, inset 0 1px 0 ${color}25` : `0 0 6px ${color}22`
                  }}
                >
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}` }}
                  />
                  <span className="text-[11px] font-medium" style={{ color: isActive ? color : color + "99", textShadow: isActive ? `0 0 8px ${color}` : "none" }}>
                    {NODE_TYPE_LABELS[type] ?? type}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
