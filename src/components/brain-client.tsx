"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  type GraphNode,
  type GraphEdge,
  type GraphData,
  type MemoryPackData,
  type ClaimsData,
  type WorkerStatusData,
  NODE_COLORS,
  NODE_TYPE_LABELS,
  NODE_TYPE_ORDER,
  StatPill,
  NodeDetail,
  MemoryPackPanel,
  ClaimsPanel,
  AgentsPanel,
} from "@/components/brain-shared";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center">
      <span className="text-[#ff6ba8] text-sm animate-pulse">Loading brain...</span>
    </div>
  )
});

export function BrainClient() {
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [memoryPack, setMemoryPack] = useState<MemoryPackData | null>(null);
  const [memoryPackLoading, setMemoryPackLoading] = useState(false);
  const [memoryPackError, setMemoryPackError] = useState<string | null>(null);
  const [claimsData, setClaimsData] = useState<ClaimsData | null>(null);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [claimsError, setClaimsError] = useState<string | null>(null);
  const [claimsRefreshNonce, setClaimsRefreshNonce] = useState(0);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [graphKey, setGraphKey] = useState(0);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatusData | null>(null);
  const [workerStatusLoading, setWorkerStatusLoading] = useState(false);

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
        setDimensions({ width: containerRef.current.offsetWidth, height: containerRef.current.offsetHeight });
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

  const fetchWorkerStatus = useCallback(async () => {
    setWorkerStatusLoading(true);
    try {
      const res = await fetch("/api/brain?mode=worker-status");
      if (!res.ok) throw new Error("Failed");
      const data = await res.json();
      setWorkerStatus(data);
    } catch {
      // silently fail — don't block graph with agent errors
    } finally {
      setWorkerStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkerStatus();
    const interval = setInterval(fetchWorkerStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchWorkerStatus]);

  // Fetch memory pack + claims when a song node is selected
  useEffect(() => {
    const spotifyTrackId =
      selectedNode?.type === "song" && typeof selectedNode.metadata.spotifyTrackId === "string"
        ? selectedNode.metadata.spotifyTrackId : null;
    const artist =
      selectedNode?.type === "song" && typeof selectedNode.metadata.artist === "string"
        ? selectedNode.metadata.artist : null;

    if (!spotifyTrackId || !artist) {
      setMemoryPack(null);
      setMemoryPackLoading(false);
      setMemoryPackError(null);
      setClaimsData(null);
      setClaimsLoading(false);
      setClaimsError(null);
      return;
    }

    let cancelled = false;

    async function fetchMemoryPack() {
      setMemoryPackLoading(true);
      setMemoryPackError(null);
      try {
        const params = new URLSearchParams({ mode: "memory-pack", spotifyTrackId: spotifyTrackId!, artist: artist! });
        const res = await fetch(`/api/brain?${params}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        if (!cancelled) setMemoryPack(data);
      } catch (e) {
        if (!cancelled) { setMemoryPack(null); setMemoryPackError(e instanceof Error ? e.message : "Failed"); }
      } finally {
        if (!cancelled) setMemoryPackLoading(false);
      }
    }

    async function fetchClaims() {
      setClaimsLoading(true);
      setClaimsError(null);
      try {
        const params = new URLSearchParams({ mode: "claims", spotifyTrackId: spotifyTrackId!, artist: artist! });
        const res = await fetch(`/api/brain?${params}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        if (!cancelled) setClaimsData(data);
      } catch (e) {
        if (!cancelled) { setClaimsData(null); setClaimsError(e instanceof Error ? e.message : "Failed"); }
      } finally {
        if (!cancelled) setClaimsLoading(false);
      }
    }

    fetchMemoryPack();
    fetchClaims();
    return () => { cancelled = true; };
  }, [selectedNode, claimsRefreshNonce]);

  const handleClaimsMutated = useCallback(() => {
    setClaimsRefreshNonce((value) => value + 1);
    void fetchWorkerStatus();
  }, [fetchWorkerStatus]);

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
    const base = n.type === "artist" ? 12 : n.type === "song" ? 7 : 4;
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
            style={{ background: "rgba(6,2,5,0.80)", border: "1px solid rgba(255,20,100,0.30)", width: 180 }}
          />
          <button
            onClick={() => fetchGraph(search || undefined, filterType ?? undefined)}
            className="h-9 rounded-xl px-4 text-[12px] font-bold text-white transition hover:brightness-110"
            style={{ background: "rgba(255,20,100,0.18)", border: "1px solid rgba(255,20,100,0.50)", boxShadow: "0 0 12px rgba(255,20,100,0.25)" }}
          >
            Search
          </button>
          {(search || filterType) && (
            <button
              onClick={() => { setSearch(""); setFilterType(null); fetchGraph(); }}
              className="h-9 rounded-xl px-4 text-[12px] font-bold text-white transition hover:brightness-110"
              style={{ background: "rgba(255,20,100,0.18)", border: "1px solid rgba(255,20,100,0.50)", boxShadow: "0 0 12px rgba(255,20,100,0.25)" }}
            >
              Clear
            </button>
          )}
          <a
            href="/brain/fullscreen"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12px] font-bold text-white transition hover:brightness-110"
            style={{ background: "rgba(255,20,100,0.18)", border: "1px solid rgba(255,20,100,0.50)", boxShadow: "0 0 12px rgba(255,20,100,0.25)" }}
            title="Open fullscreen"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
            Fullscreen
          </a>
        </div>
      </header>

      {/* Stats + type filter pills */}
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

      {/* Graph + sidebar */}
      <div className="flex gap-4" style={{ height: 560 }}>
        {/* Graph canvas */}
        <div
          ref={containerRef}
          className="flex-1 rounded-2xl overflow-hidden relative"
          style={{ background: "rgba(6,2,5,0.85)", border: "1px solid rgba(255,20,100,0.25)", boxShadow: "0 0 40px rgba(255,20,100,0.10), inset 0 1px 0 rgba(255,20,100,0.12)" }}
        >
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="h-10 w-10 rounded-full border-2 border-[#ff1464] border-t-transparent animate-spin" style={{ boxShadow: "0 0 16px rgba(255,20,100,0.60)" }} />
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
                  if (!initialFitDone.current) { fgRef.current?.zoomToFit(400, 80); initialFitDone.current = true; }
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  graphData?.nodes.forEach((n: any) => { n.fx = n.x; n.fy = n.y; n.fz = n.z; });
                  try { const controls = fgRef.current?.controls(); if (controls) controls.zoomSpeed = 3; } catch {}
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
          {!loading && !error && graphData?.nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-[13px] text-[#8a7898]">No nodes found — try a different search</p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="flex w-64 flex-shrink-0 flex-col gap-3 overflow-y-auto">
          <NodeDetail node={activeNode} />
          <MemoryPackPanel memoryPack={memoryPack} loading={memoryPackLoading} error={memoryPackError} />
          <ClaimsPanel
            claimsData={claimsData}
            loading={claimsLoading}
            error={claimsError}
            onActionComplete={handleClaimsMutated}
          />

          {/* Legend */}
          <div
            className="rounded-2xl p-4 flex flex-col gap-1.5"
            style={{ background: "rgba(6,2,5,0.92)", border: "1px solid rgba(255,20,100,0.20)", boxShadow: "0 0 12px rgba(255,20,100,0.10)" }}
          >
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a7898] mb-2">Node types</p>
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
        </div>
      </div>
      <AgentsPanel data={workerStatus} loading={workerStatusLoading} onRefresh={fetchWorkerStatus} />
    </div>
  );
}
