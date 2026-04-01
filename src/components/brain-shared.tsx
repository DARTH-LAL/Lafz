"use client";

import { useState } from "react";
import { NODE_COLORS as _NODE_COLORS } from "@/features/brain/colors";

// ─── Shared types ────────────────────────────────────────────────────────────

export type GraphNode = {
  id: string;
  label: string;
  type: string;
  color: string;
  confidence: string;
  metadata: Record<string, unknown>;
  x?: number;
  y?: number;
};

export type GraphEdge = {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  weight: number;
  evidence: string | null;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: {
    nodeCount: number;
    edgeCount: number;
    nodeTypeCounts: Record<string, number>;
  };
};

export type MemoryPackTextHint = {
  value: string;
  score: number;
  confidence: string;
  reasons: string[];
};

export type MemoryPackSymbolHint = {
  symbol: string;
  score: number;
  confidence: string;
  frequency: number;
  reasons: string[];
};

export type MemoryPackRenderingHint = {
  term: string;
  meaning: string;
  score: number;
  confidence: string;
  reasons: string[];
};

export type MemoryPackData = {
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

export type BrainClaimEvidence = {
  id: string;
  sourceType: string;
  spotifyTrackId: string | null;
  artistKey: string | null;
  lineOrder: number | null;
  weight: number;
  payload: Record<string, unknown>;
  createdAt: string | null;
};

export type BrainClaim = {
  id: string;
  claimKey: string;
  claimType: string;
  scopeType: string;
  scopeKey: string;
  status: string;
  confidenceScore: number;
  sourceCount: number;
  evidenceCount: number;
  updatedAt: string | null;
  payload: Record<string, unknown>;
  evidence: BrainClaimEvidence[];
  latestPromotion: {
    id: string;
    decision: string;
    reason: string | null;
    decidedBy: string | null;
    createdAt: string | null;
  } | null;
};

export type ClaimsData = {
  spotifyTrackId: string;
  artist: string;
  claimCount: number;
  claims: BrainClaim[];
};

// ─── Shared constants ─────────────────────────────────────────────────────────

// Re-export from the single source of truth so UI components only need one import
export const NODE_COLORS: Record<string, string> = _NODE_COLORS;

export const NODE_TYPE_LABELS: Record<string, string> = {
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

export const NODE_TYPE_ORDER = [
  "artist", "song", "motif", "symbol", "term_surface",
  "term_sense", "rendering", "entity_instance", "entity_type", "persona_style"
];

// ─── Shared helpers ───────────────────────────────────────────────────────────

export function formatClaimLabel(claim: BrainClaim): string {
  const payload = claim.payload ?? {};
  if (typeof payload.motif === "string" && payload.motif) return payload.motif;
  if (typeof payload.symbol === "string" && payload.symbol) return payload.symbol;
  if (
    typeof payload.sourceEntity === "string" && payload.sourceEntity &&
    typeof payload.dynamic === "string" && payload.dynamic &&
    typeof payload.targetEntity === "string" && payload.targetEntity
  ) {
    return `${payload.sourceEntity} -> ${payload.dynamic} -> ${payload.targetEntity}`;
  }
  if (typeof payload.term === "string" && payload.term && typeof payload.meaning === "string" && payload.meaning) {
    return `${payload.term} -> ${payload.meaning}`;
  }
  return claim.claimType.replace(/_/g, " ");
}

export function getClaimStatusStyle(status: string) {
  if (status === "accepted") return { background: "rgba(52,211,153,0.12)", color: "#34d399", border: "1px solid rgba(52,211,153,0.28)" };
  if (status === "rejected") return { background: "rgba(251,113,133,0.12)", color: "#fb7185", border: "1px solid rgba(251,113,133,0.28)" };
  if (status === "deferred")  return { background: "rgba(250,204,21,0.12)",  color: "#facc15", border: "1px solid rgba(250,204,21,0.28)" };
  return { background: "rgba(255,20,100,0.10)", color: "#ff6ba8", border: "1px solid rgba(255,20,100,0.20)" };
}

// ─── Shared components ────────────────────────────────────────────────────────

export function StatPill({ label, value }: { label: string; value: string | number }) {
  return (
    <div
      className="flex flex-col items-center gap-0.5 rounded-xl px-4 py-2"
      style={{
        background: "rgba(6,2,5,0.92)",
        border: "1px solid rgba(255,20,100,0.45)",
        boxShadow: "0 0 0 1px rgba(255,20,100,0.10), 0 0 14px rgba(255,20,100,0.30), inset 0 1px 0 rgba(255,20,100,0.12)"
      }}
    >
      <span className="text-[18px] font-bold text-white">
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-widest text-[#8a7898]">{label}</span>
    </div>
  );
}

/** Node detail card. Pass `onClose` to show a dismiss × button (fullscreen mode). */
export function NodeDetail({ node, onClose }: { node: GraphNode | null; onClose?: () => void }) {
  if (!node) return null;
  const meta = node.metadata ?? {};
  return (
    <div
      className="flex flex-col gap-2 rounded-2xl p-4"
      style={{
        background: "rgba(6,2,5,0.94)",
        border: "1px solid rgba(255,20,100,0.40)",
        boxShadow: "0 0 24px rgba(255,20,100,0.20)"
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ background: node.color, boxShadow: `0 0 8px ${node.color}` }} />
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: node.color }}>
            {NODE_TYPE_LABELS[node.type] ?? node.type}
          </span>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-[#8a7898] hover:text-white transition text-[18px] leading-none" aria-label="Close">×</button>
        )}
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

export function RetrievalSection({ title, items }: { title: string; items: Array<{ label: string; score: number; subtitle?: string }> }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a7898]">{title}</p>
      <div className="flex flex-col gap-1.5">
        {items.map((item) => (
          <div
            key={`${title}-${item.label}`}
            className="rounded-xl px-3 py-2"
            style={{ background: "rgba(15,8,12,0.9)", border: "1px solid rgba(255,20,100,0.16)" }}
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

export function MemoryPackPanel({ memoryPack, loading, error }: { memoryPack: MemoryPackData | null; loading: boolean; error?: string | null }) {
  if (loading) {
    return (
      <div className="rounded-2xl p-4" style={{ background: "rgba(6,2,5,0.92)", border: "1px solid rgba(255,20,100,0.20)", boxShadow: "0 0 12px rgba(255,20,100,0.10)" }}>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a7898]">Retrieval</p>
        <p className="mt-2 text-[12px] text-[#ff6ba8]">Loading memory pack…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl p-4" style={{ background: "rgba(6,2,5,0.92)", border: "1px solid rgba(251,113,133,0.30)", boxShadow: "0 0 12px rgba(251,113,133,0.10)" }}>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a7898]">Retrieval</p>
        <p className="mt-2 text-[12px] text-[#fb7185]">Couldn&apos;t load retrieval data.</p>
        <p className="mt-0.5 text-[11px] text-[#8a7898]">Click the node again to retry.</p>
      </div>
    );
  }
  if (!memoryPack) return null;

  const topStyle         = memoryPack.pack.styleHintDetails.slice(0, 3).map(i => ({ label: i.value, score: i.score, subtitle: i.reasons[0] }));
  const topMotifs        = memoryPack.pack.motifHintDetails.slice(0, 3).map(i => ({ label: i.value, score: i.score, subtitle: i.reasons[0] }));
  const topRelationships = memoryPack.pack.relationshipPriorDetails.slice(0, 3).map(i => ({ label: i.value, score: i.score, subtitle: i.reasons[0] }));
  const topSymbols       = memoryPack.pack.symbolHints.slice(0, 3).map(i => ({ label: i.symbol, score: i.score, subtitle: `${i.frequency} prior song${i.frequency === 1 ? "" : "s"}` }));
  const topRenderings    = memoryPack.pack.renderingHints.slice(0, 4).map(i => ({ label: `${i.term} -> ${i.meaning}`, score: i.score, subtitle: i.reasons[0] }));

  return (
    <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: "rgba(6,2,5,0.92)", border: "1px solid rgba(255,20,100,0.20)", boxShadow: "0 0 12px rgba(255,20,100,0.10)" }}>
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
          <span key={rule} className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest" style={{ background: "rgba(255,20,100,0.10)", color: "#ff6ba8", border: "1px solid rgba(255,20,100,0.20)" }}>
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

const STATUS_ORDER: Record<string, number> = { accepted: 0, deferred: 1, rejected: 2 };

function sortClaims(claims: BrainClaim[]): BrainClaim[] {
  return [...claims].sort((a, b) => {
    const sa = STATUS_ORDER[a.latestPromotion?.decision ?? a.status] ?? 3;
    const sb = STATUS_ORDER[b.latestPromotion?.decision ?? b.status] ?? 3;
    if (sa !== sb) return sa - sb;
    return b.confidenceScore - a.confidenceScore;
  });
}

export function ClaimsPanel({ claimsData, loading, error }: { claimsData: ClaimsData | null; loading: boolean; error?: string | null }) {
  const [showAll, setShowAll] = useState(false);
  const [expandedEvidence, setExpandedEvidence] = useState<Set<string>>(new Set());

  if (loading) {
    return (
      <div className="rounded-2xl p-4" style={{ background: "rgba(6,2,5,0.92)", border: "1px solid rgba(255,20,100,0.20)", boxShadow: "0 0 12px rgba(255,20,100,0.10)" }}>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a7898]">Claims</p>
        <p className="mt-2 text-[12px] text-[#ff6ba8]">Loading claims…</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-2xl p-4" style={{ background: "rgba(6,2,5,0.92)", border: "1px solid rgba(251,113,133,0.30)", boxShadow: "0 0 12px rgba(251,113,133,0.10)" }}>
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a7898]">Claims</p>
        <p className="mt-2 text-[12px] text-[#fb7185]">Couldn&apos;t load claims.</p>
        <p className="mt-0.5 text-[11px] text-[#8a7898]">Click the node again to retry.</p>
      </div>
    );
  }
  if (!claimsData || claimsData.claims.length === 0) return null;

  const sorted = sortClaims(claimsData.claims);
  const accepted = sorted.filter(c => (c.latestPromotion?.decision ?? c.status) === "accepted").length;
  const rejected = sorted.filter(c => (c.latestPromotion?.decision ?? c.status) === "rejected").length;
  const deferred = sorted.filter(c => (c.latestPromotion?.decision ?? c.status) === "deferred").length;

  const PAGE = 6;
  const visible = showAll ? sorted : sorted.slice(0, PAGE);
  const hasMore = sorted.length > PAGE;

  function toggleEvidence(id: string) {
    setExpandedEvidence(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: "rgba(6,2,5,0.92)", border: "1px solid rgba(255,20,100,0.20)", boxShadow: "0 0 12px rgba(255,20,100,0.10)" }}>
      <div className="flex flex-col gap-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a7898]">Claims</p>
        <p className="text-[11px] text-[#8a7898]">
          {claimsData.claimCount} claim{claimsData.claimCount === 1 ? "" : "s"} • {accepted} accepted • {deferred} deferred • {rejected} rejected
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {visible.map((claim) => {
          const displayStatus = claim.latestPromotion?.decision ?? claim.status;
          const statusStyle = getClaimStatusStyle(displayStatus);
          const allEvidence = claim.evidence;
          const evidenceExpanded = expandedEvidence.has(claim.id);
          const shownEvidence = evidenceExpanded ? allEvidence : allEvidence.slice(0, 2);
          const hasMoreEvidence = allEvidence.length > 2;

          return (
            <div key={claim.id} className="rounded-xl px-3 py-3" style={{ background: "rgba(15,8,12,0.9)", border: "1px solid rgba(255,20,100,0.16)" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-semibold text-white leading-snug">{formatClaimLabel(claim)}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-widest text-[#8a7898]">{claim.claimType.replace(/_/g, " ")} • {claim.scopeType}</p>
                </div>
                <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest flex-shrink-0" style={statusStyle}>{displayStatus}</span>
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-full border border-[rgba(255,20,100,0.16)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[#ff6ba8]">conf {claim.confidenceScore.toFixed(2)}</span>
                <span className="rounded-full border border-[rgba(255,20,100,0.16)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[#8a7898]">evidence {claim.evidenceCount}</span>
                <span className="rounded-full border border-[rgba(255,20,100,0.16)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-[#8a7898]">sources {claim.sourceCount}</span>
              </div>

              {claim.latestPromotion?.reason && (
                <p className="mt-2 text-[11px] leading-snug text-[#8a7898]">{claim.latestPromotion.reason}</p>
              )}

              {shownEvidence.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5">
                  {shownEvidence.map((ev) => (
                    <div key={ev.id} className="rounded-lg border border-[rgba(255,20,100,0.12)] px-2.5 py-2">
                      <p className="text-[10px] uppercase tracking-widest text-[#ff6ba8]">{ev.sourceType.replace(/_/g, " ")} • {ev.weight.toFixed(2)}</p>
                      {typeof ev.payload.original === "string" && ev.payload.original ? (
                        <p className="mt-1 text-[11px] leading-snug text-white/90">{String(ev.payload.original)}</p>
                      ) : typeof ev.payload.summary === "string" && ev.payload.summary ? (
                        <p className="mt-1 text-[11px] leading-snug text-white/80">{String(ev.payload.summary)}</p>
                      ) : typeof ev.payload.evidence === "string" && ev.payload.evidence ? (
                        <p className="mt-1 text-[11px] leading-snug text-white/80">{String(ev.payload.evidence)}</p>
                      ) : null}
                    </div>
                  ))}
                  {hasMoreEvidence && (
                    <button
                      onClick={() => toggleEvidence(claim.id)}
                      className="mt-0.5 text-[10px] font-bold text-[#ff6ba8] hover:text-white transition text-left"
                    >
                      {evidenceExpanded ? "Show less" : `+${allEvidence.length - 2} more evidence`}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {hasMore && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="mt-1 w-full rounded-xl py-2 text-[11px] font-bold text-[#ff6ba8] transition hover:text-white"
          style={{ background: "rgba(255,20,100,0.08)", border: "1px solid rgba(255,20,100,0.20)" }}
        >
          {showAll ? "Show less" : `Show all ${sorted.length} claims`}
        </button>
      )}
    </div>
  );
}
