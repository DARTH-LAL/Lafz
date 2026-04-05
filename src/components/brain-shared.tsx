"use client";

import { useCallback, useState } from "react";
import { FloatingToast } from "@/components/floating-toast";
import { NODE_COLORS as _NODE_COLORS } from "@/features/brain/colors";
import type { LafzBrainCriticEvaluationReport, LafzBrainReviewItem, LafzBrainReviewSummary } from "@/features/brain/types";

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
  reviewQueue: LafzBrainReviewItem[];
  reviewSummary: LafzBrainReviewSummary;
};

export type AgentJobHealth = {
  activeJobCount: number;
  staleJobCount: number;
  oldestStaleHeartbeatAt: string | null;
  oldestStaleJobAgeMs: number | null;
  sampleStaleJobKeys: string[];
};

export type AgentWorkerStatus = {
  runtimeMode: string;
  workerId: string | null;
  inFlight: boolean;
  intervalActive: boolean;
  startedAt: string | null;
  lastKickReason: string | null;
  lastActivityAt: string | null;
  lastSummary: Record<string, unknown> | null;
  jobHealth?: AgentJobHealth;
};

export type LearningProfile = {
  scopeType: string;
  claimType: string;
  normalizedKey: string;
  signalCount: number;
  acceptedCount: number;
  rejectedCount: number;
  deferredCount: number;
  manualOverrideCount: number;
  confidenceBias: number;
  lastDecision: string | null;
  lastDecidedBy: string | null;
  lastDecisionAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type LearningSummary = {
  profileCount: number;
  signalCount: number;
  acceptedCount: number;
  rejectedCount: number;
  deferredCount: number;
  manualOverrideCount: number;
  positiveProfiles: number;
  negativeProfiles: number;
  confidenceBiasTotal: number;
  averageConfidenceBias: number;
};

export type AgentRun = {
  id: string;
  job_id: string;
  agent_role: string;
  status: string;
  worker_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  output_json: Record<string, unknown> | null;
  error_text: string | null;
  created_at: string;
};

export type WorkerStatusData = {
  worker: AgentWorkerStatus;
  queueCounts: Record<string, number>;
  entityWorker: AgentWorkerStatus;
  entityQueueCounts: Record<string, number>;
  motifWorker: AgentWorkerStatus;
  motifQueueCounts: Record<string, number>;
  personaWorker: AgentWorkerStatus;
  personaQueueCounts: Record<string, number>;
  cleanupWorker: AgentWorkerStatus;
  cleanupQueueCounts: Record<string, number>;
  criticEvaluation: LafzBrainCriticEvaluationReport;
  learningSummary: LearningSummary;
  learningProfiles: LearningProfile[];
  recentContributionTotals: {
    vocabulary: { claimsUpserted: number; evidencesInserted: number; promotionsRecorded: number };
    entity: { claimsUpserted: number; evidencesInserted: number; promotionsRecorded: number };
    motif: { claimsUpserted: number; evidencesInserted: number; promotionsRecorded: number };
    persona: { claimsUpserted: number; evidencesInserted: number; promotionsRecorded: number };
    cleanup: { actionsApplied: number; rejected: number; deprecated: number };
  };
  recentRuns: AgentRun[];
};

type ClaimAction = "accept" | "reject" | "restore";

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

// ─── Agents panel ─────────────────────────────────────────────────────────────

const AGENT_META: Array<{
  key: keyof WorkerStatusData;
  countsKey: keyof WorkerStatusData;
  label: string;
  color: string;
  totalsKey: keyof WorkerStatusData["recentContributionTotals"];
}> = [
  { key: "worker",        countsKey: "queueCounts",      label: "Vocabulary", color: "#a78bfa", totalsKey: "vocabulary" },
  { key: "entityWorker",  countsKey: "entityQueueCounts", label: "Entity",    color: "#34d399", totalsKey: "entity" },
  { key: "motifWorker",   countsKey: "motifQueueCounts",  label: "Motif",     color: "#60a5fa", totalsKey: "motif" },
  { key: "personaWorker", countsKey: "personaQueueCounts",label: "Persona",   color: "#f472b6", totalsKey: "persona" },
  { key: "cleanupWorker", countsKey: "cleanupQueueCounts",label: "Cleanup",   color: "#facc15", totalsKey: "cleanup" },
];

function AgentStatusDot({ worker, color }: { worker: AgentWorkerStatus; color: string }) {
  const active = worker.inFlight;
  const idle   = !active && worker.intervalActive;
  const dotColor = active ? "#34d399" : idle ? color : "#ffffff";
  const pulse    = active;
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${pulse ? "animate-pulse" : ""}`}
      style={{ background: dotColor, boxShadow: active ? `0 0 8px ${dotColor}` : idle ? `0 0 5px ${dotColor}88` : "none" }}
    />
  );
}

function fmtAge(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

function fmtBias(value: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}`;
}

function fmtPct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function AgentCard({ worker, queueCounts, label, color, totals }: {
  worker: AgentWorkerStatus;
  queueCounts: Record<string, number>;
  label: string;
  color: string;
  totals: WorkerStatusData["recentContributionTotals"][keyof WorkerStatusData["recentContributionTotals"]];
}) {
  const pending    = queueCounts.pending ?? 0;
  const running    = queueCounts.running ?? 0;
  const completed  = queueCounts.completed ?? 0;
  const failed     = queueCounts.failed ?? 0;
  const deadLetter = queueCounts.dead_lettered ?? 0;

  const isCleanup = "actionsApplied" in totals;
  const cleanupTotals = isCleanup ? totals as { actionsApplied: number; rejected: number; deprecated: number } : null;
  const claimTotals = !isCleanup ? totals as { claimsUpserted: number; evidencesInserted: number; promotionsRecorded: number } : null;

  const lastActivity = worker.lastActivityAt
    ? new Date(worker.lastActivityAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const health = worker.jobHealth;
  const hasStale = (health?.staleJobCount ?? 0) > 0;
  const staleAgeLabel = health?.oldestStaleJobAgeMs != null ? fmtAge(health.oldestStaleJobAgeMs) : null;

  return (
    <div
      className="flex flex-col gap-3 rounded-2xl p-4"
      style={{
        background: "rgba(6,2,5,0.92)",
        border: `1px solid ${hasStale ? "rgba(251,113,133,0.45)" : color + "33"}`,
        boxShadow: hasStale
          ? "0 0 16px rgba(251,113,133,0.18), inset 0 1px 0 rgba(251,113,133,0.12)"
          : `0 0 16px ${color}15, inset 0 1px 0 ${color}18`
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AgentStatusDot worker={worker} color={color} />
          <span className="text-[13px] font-bold" style={{ color, textShadow: `0 0 8px ${color}66` }}>{label}</span>
        </div>
        <span
          className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
          style={{
            background: worker.inFlight ? "rgba(52,211,153,0.12)" : "rgba(255,255,255,0.05)",
            color: worker.inFlight ? "#34d399" : "#ffffff",
            border: `1px solid ${worker.inFlight ? "rgba(52,211,153,0.28)" : "rgba(255,255,255,0.10)"}`
          }}
        >
          {worker.inFlight ? "running" : worker.intervalActive ? "idle" : "inactive"}
        </span>
      </div>

      {/* Queue counts */}
      <div className="grid grid-cols-4 gap-1.5">
        {[
          { label: "pend",   value: pending,    c: pending > 0 ? color : "#ffffff" },
          { label: "run",    value: running,    c: running > 0 ? "#34d399" : "#ffffff" },
          { label: "done",   value: completed,  c: "#ffffff" },
          { label: "fail",   value: failed + deadLetter, c: (failed + deadLetter) > 0 ? "#fb7185" : "#ffffff" },
        ].map((stat) => (
          <div key={stat.label} className="flex flex-col items-center gap-1 rounded-xl py-4" style={{ background: "rgba(0,0,0,0.30)", border: `1px solid ${stat.c}22` }}>
            <span className="text-[20px] font-bold" style={{ color: stat.c }}>{stat.value}</span>
            <span className="text-[9px] uppercase tracking-tight font-semibold text-[#ffffff]">{stat.label}</span>
          </div>
        ))}
      </div>

      {/* Job health */}
      {health && (
        <div
          className="flex flex-col gap-1.5 rounded-xl px-3 py-2.5"
          style={{
            background: hasStale ? "rgba(251,113,133,0.07)" : "rgba(0,0,0,0.22)",
            border: hasStale ? "1px solid rgba(251,113,133,0.25)" : "1px solid rgba(255,255,255,0.06)"
          }}
        >
          <p className="text-[9px] font-bold uppercase tracking-widest" style={{ color: hasStale ? "#fb7185" : "#ffffff" }}>
            Job Health
          </p>
          <div className="flex flex-wrap gap-1.5">
            {/* Active jobs in DB */}
            <span
              className="rounded-full px-2 py-0.5 text-[9px] font-semibold"
              style={{
                background: health.activeJobCount > 0 ? "rgba(52,211,153,0.10)" : "rgba(255,255,255,0.05)",
                color: health.activeJobCount > 0 ? "#34d399" : "#ffffff",
                border: `1px solid ${health.activeJobCount > 0 ? "rgba(52,211,153,0.25)" : "rgba(255,255,255,0.08)"}`
              }}
            >
              {health.activeJobCount} active
            </span>
            {/* Stale jobs */}
            {hasStale ? (
              <span
                className="rounded-full px-2 py-0.5 text-[9px] font-semibold"
                style={{ background: "rgba(251,113,133,0.12)", color: "#fb7185", border: "1px solid rgba(251,113,133,0.28)" }}
              >
                ⚠ {health.staleJobCount} stale{staleAgeLabel ? ` · oldest ${staleAgeLabel}` : ""}
              </span>
            ) : (
              <span
                className="rounded-full px-2 py-0.5 text-[9px] font-semibold"
                style={{ background: "rgba(52,211,153,0.08)", color: "#34d399", border: "1px solid rgba(52,211,153,0.18)" }}
              >
                ✓ no stale
              </span>
            )}
          </div>
          {/* Sample stale keys */}
          {hasStale && health.sampleStaleJobKeys.length > 0 && (
            <div className="flex flex-col gap-0.5 mt-0.5">
              {health.sampleStaleJobKeys.slice(0, 3).map((key) => (
                <p key={key} className="truncate text-[9px] font-mono text-[#fb7185] opacity-70">{key}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recent contribution totals */}
      <div className="flex flex-col gap-1">
        <p className="text-[9px] font-bold uppercase tracking-widest text-[#ffffff]">Last 24 runs</p>
        {claimTotals && (
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold" style={{ background: `${color}12`, color, border: `1px solid ${color}28` }}>
              {claimTotals.claimsUpserted} claims
            </span>
            <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold" style={{ background: "rgba(255,255,255,0.05)", color: "#ffffff", border: "1px solid rgba(255,255,255,0.08)" }}>
              {claimTotals.evidencesInserted} evidence
            </span>
            <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold" style={{ background: "rgba(255,255,255,0.05)", color: "#ffffff", border: "1px solid rgba(255,255,255,0.08)" }}>
              {claimTotals.promotionsRecorded} promotions
            </span>
          </div>
        )}
        {cleanupTotals && (
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold" style={{ background: `${color}12`, color, border: `1px solid ${color}28` }}>
              {cleanupTotals.actionsApplied} actions
            </span>
            <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold" style={{ background: "rgba(251,113,133,0.10)", color: "#fb7185", border: "1px solid rgba(251,113,133,0.20)" }}>
              {cleanupTotals.rejected} rejected
            </span>
            <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold" style={{ background: "rgba(255,255,255,0.05)", color: "#ffffff", border: "1px solid rgba(255,255,255,0.08)" }}>
              {cleanupTotals.deprecated} deprecated
            </span>
          </div>
        )}
      </div>

      {/* Last activity */}
      {lastActivity && (
        <p className="text-[10px] text-[#ffffff]">
          Last active <span className="text-white">{lastActivity}</span>
        </p>
      )}
    </div>
  );
}

export function AgentsPanel({ data, loading, onRefresh }: {
  data: WorkerStatusData | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [showRuns, setShowRuns] = useState(false);

  return (
    <div className="flex flex-col gap-4 mt-6">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-0.5 w-7 rounded-full bg-[linear-gradient(90deg,#a78bfa,transparent)] shadow-[0_0_8px_#a78bfa]" />
          <p className="text-[11px] font-bold uppercase tracking-[2.5px] text-[#a78bfa] [text-shadow:0_0_16px_rgba(167,139,250,0.6)]">
            Agents
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-xl px-4 py-1.5 text-[12px] font-bold text-white transition hover:brightness-110 disabled:opacity-50"
          style={{ background: "rgba(255,20,100,0.18)", border: "1px solid rgba(255,20,100,0.50)", boxShadow: "0 0 12px rgba(255,20,100,0.25)" }}
        >
          <svg viewBox="0 0 24 24" className={`h-3 w-3 fill-current ${loading ? "animate-spin" : ""}`} aria-hidden="true">
            <path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
          </svg>
          Refresh
        </button>
      </div>

      {loading && !data && (
        <div className="flex items-center gap-3 rounded-2xl p-6" style={{ background: "rgba(6,2,5,0.85)", border: "1px solid rgba(167,139,250,0.20)" }}>
          <div className="h-5 w-5 rounded-full border-2 border-[#a78bfa] border-t-transparent animate-spin" />
          <span className="text-[12px] text-[#a78bfa]">Loading agent status…</span>
        </div>
      )}

      {data && (
        <>
          {/* Agent cards grid */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {AGENT_META.map(({ key, countsKey, label, color, totalsKey }) => (
              <AgentCard
                key={label}
                worker={data[key] as AgentWorkerStatus}
                queueCounts={data[countsKey] as Record<string, number>}
                label={label}
                color={color}
                totals={data.recentContributionTotals[totalsKey]}
              />
            ))}
          </div>

          {/* Learning summary */}
          <div
            className="flex flex-col gap-3 rounded-2xl p-4"
            style={{
              background: "rgba(6,2,5,0.92)",
              border: "1px solid rgba(255,20,100,0.20)",
              boxShadow: "0 0 12px rgba(255,20,100,0.10)"
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a7898]">Learning</p>
                <p className="mt-1 text-[12px] text-white font-semibold">
                  {data.learningSummary.profileCount > 0
                    ? `${data.learningSummary.signalCount} signals across ${data.learningSummary.profileCount} profiles`
                    : "Waiting for the first feedback signals"}
                </p>
                <p className="mt-0.5 text-[11px] text-[#8a7898]">
                  Positive profiles: {data.learningSummary.positiveProfiles} • Negative profiles: {data.learningSummary.negativeProfiles}
                </p>
              </div>
              <span
                className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
                style={{
                  background: data.learningSummary.averageConfidenceBias >= 0 ? "rgba(52,211,153,0.12)" : "rgba(251,113,133,0.12)",
                  color: data.learningSummary.averageConfidenceBias >= 0 ? "#34d399" : "#fb7185",
                  border: `1px solid ${data.learningSummary.averageConfidenceBias >= 0 ? "rgba(52,211,153,0.25)" : "rgba(251,113,133,0.25)"}`
                }}
              >
                avg bias {fmtBias(data.learningSummary.averageConfidenceBias)}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold text-white" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                {data.learningSummary.acceptedCount} accepted
              </span>
              <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold text-white" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                {data.learningSummary.deferredCount} deferred
              </span>
              <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold text-white" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                {data.learningSummary.rejectedCount} rejected
              </span>
              <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold text-white" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                {data.learningSummary.manualOverrideCount} manual overrides
              </span>
            </div>

            {data.learningProfiles.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {data.learningProfiles.slice(0, 4).map((profile) => (
                  <div
                    key={`${profile.scopeType}:${profile.claimType}:${profile.normalizedKey}`}
                    className="rounded-xl px-3 py-2.5"
                    style={{ background: "rgba(15,8,12,0.88)", border: "1px solid rgba(255,20,100,0.14)" }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-semibold text-white">
                          {profile.claimType.replace(/_/g, " ")}
                        </p>
                        <p className="mt-0.5 text-[9px] uppercase tracking-widest text-[#8a7898]">
                          {profile.scopeType} • {profile.signalCount} signals
                        </p>
                      </div>
                      <span
                        className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
                        style={{
                          background: profile.confidenceBias >= 0 ? "rgba(52,211,153,0.10)" : "rgba(251,113,133,0.10)",
                          color: profile.confidenceBias >= 0 ? "#34d399" : "#fb7185",
                          border: `1px solid ${profile.confidenceBias >= 0 ? "rgba(52,211,153,0.22)" : "rgba(251,113,133,0.22)"}`
                        }}
                      >
                        {fmtBias(profile.confidenceBias)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-[#8a7898]">{profile.normalizedKey}</p>
                    <p className="mt-1 text-[10px] text-[#8a7898]">
                      {profile.acceptedCount} accepted • {profile.rejectedCount} rejected • {profile.deferredCount} deferred
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Critic evaluation */}
          <div
            className="flex flex-col gap-3 rounded-2xl p-4"
            style={{
              background: "rgba(6,2,5,0.92)",
              border: "1px solid rgba(96,165,250,0.20)",
              boxShadow: "0 0 12px rgba(96,165,250,0.10)"
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#60a5fa]">Critic Eval</p>
                <p className="mt-1 text-[12px] text-white font-semibold">
                  {data.criticEvaluation.passedCases}/{data.criticEvaluation.totalCases} cases pass
                </p>
                <p className="mt-0.5 text-[11px] text-[#8a7898]">
                  {data.criticEvaluation.failedCases} mismatches • generated {new Date(data.criticEvaluation.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <span
                className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
                style={{
                  background: data.criticEvaluation.passRate >= 1 ? "rgba(52,211,153,0.12)" : "rgba(250,204,21,0.12)",
                  color: data.criticEvaluation.passRate >= 1 ? "#34d399" : "#facc15",
                  border: `1px solid ${data.criticEvaluation.passRate >= 1 ? "rgba(52,211,153,0.25)" : "rgba(250,204,21,0.25)"}`
                }}
              >
                pass {fmtPct(data.criticEvaluation.passRate)}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold text-white" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                band {fmtPct(data.criticEvaluation.reviewBandAccuracy)}
              </span>
              <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold text-white" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                recommendation {fmtPct(data.criticEvaluation.reviewRecommendationAccuracy)}
              </span>
              <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold text-white" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                queue {fmtPct(data.criticEvaluation.queueAccuracy)}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold text-[#60a5fa]" style={{ background: "rgba(96,165,250,0.10)", border: "1px solid rgba(96,165,250,0.22)" }}>
                {data.criticEvaluation.bandCounts.high} high
              </span>
              <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold text-[#facc15]" style={{ background: "rgba(250,204,21,0.10)", border: "1px solid rgba(250,204,21,0.22)" }}>
                {data.criticEvaluation.bandCounts.medium} medium
              </span>
              <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold text-[#34d399]" style={{ background: "rgba(52,211,153,0.10)", border: "1px solid rgba(52,211,153,0.22)" }}>
                {data.criticEvaluation.bandCounts.low} low
              </span>
              <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold text-white" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                {data.criticEvaluation.queueCounts.queued} queued • {data.criticEvaluation.queueCounts.skipped} skipped
              </span>
            </div>

            {data.criticEvaluation.topFailures.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {data.criticEvaluation.topFailures.slice(0, 3).map((entry) => (
                  <div key={entry.id} className="rounded-xl px-3 py-2" style={{ background: "rgba(15,8,12,0.88)", border: "1px solid rgba(251,113,133,0.18)" }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-semibold text-white">{entry.id}</p>
                        <p className="mt-0.5 text-[9px] uppercase tracking-widest text-[#8a7898]">
                          {entry.claimType.replace(/_/g, " ")} • {entry.scopeType}
                        </p>
                      </div>
                      <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest" style={{ background: "rgba(251,113,133,0.12)", color: "#fb7185", border: "1px solid rgba(251,113,133,0.24)" }}>
                        {entry.mismatches.length} mismatch{entry.mismatches.length === 1 ? "" : "es"}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-[11px] text-[#8a7898]">{entry.claimKey}</p>
                    <p className="mt-1 text-[10px] leading-snug text-[#8a7898]">{entry.mismatches[0]}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-[rgba(52,211,153,0.18)] bg-[rgba(52,211,153,0.06)] px-3 py-3">
                <p className="text-[11px] font-semibold text-white">The critic matches the eval set.</p>
                <p className="mt-1 text-[11px] text-[#8a7898]">No mismatches surfaced in the current benchmark.</p>
              </div>
            )}
          </div>

          {/* Recent runs toggle */}
          {data.recentRuns.length > 0 && (
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setShowRuns(v => !v)}
                className="flex items-center gap-1.5 self-start text-[10px] font-bold uppercase tracking-widest text-white hover:text-white transition"
              >
                <svg viewBox="0 0 24 24" className={`h-3 w-3 fill-current transition-transform ${showRuns ? "rotate-90" : ""}`} aria-hidden="true">
                  <path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
                </svg>
                {showRuns ? "Hide" : "Show"} recent runs ({data.recentRuns.length})
              </button>
              {showRuns && (
                <div className="overflow-x-auto rounded-2xl" style={{ background: "rgba(6,2,5,0.90)", border: "1px solid rgba(167,139,250,0.18)" }}>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr style={{ borderBottom: "1px solid rgba(167,139,250,0.15)" }}>
                        {["Agent", "Status", "Started", "Duration", "Output"].map(h => (
                          <th key={h} className="px-4 py-3 text-left font-bold uppercase tracking-widest text-[#ffffff]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentRuns.slice(0, 16).map((run) => {
                        const agentColor = AGENT_META.find(a => a.label.toLowerCase() + "_agent" === run.agent_role)?.color ?? "#ffffff";
                        const durationMs = run.started_at && run.finished_at
                          ? new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()
                          : null;
                        const duration = durationMs !== null
                          ? durationMs > 60000 ? `${(durationMs / 60000).toFixed(1)}m` : `${(durationMs / 1000).toFixed(1)}s`
                          : "—";
                        const output = run.output_json ?? {};
                        const outputStr = run.status === "failed"
                          ? (run.error_text ?? "error")
                          : Object.entries(output).filter(([, v]) => typeof v === "number").map(([k, v]) => `${k}: ${v}`).join(", ") || "—";

                        return (
                          <tr key={run.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                            <td className="px-4 py-2.5 font-semibold" style={{ color: agentColor }}>{run.agent_role.replace("_agent", "")}</td>
                            <td className="px-4 py-2.5">
                              <span
                                className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
                                style={
                                  run.status === "completed" ? { background: "rgba(52,211,153,0.12)", color: "#34d399", border: "1px solid rgba(52,211,153,0.25)" } :
                                  run.status === "failed"    ? { background: "rgba(251,113,133,0.12)", color: "#fb7185", border: "1px solid rgba(251,113,133,0.25)" } :
                                  run.status === "running"   ? { background: "rgba(167,139,250,0.12)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.25)" } :
                                  { background: "rgba(255,255,255,0.05)", color: "#ffffff", border: "1px solid rgba(255,255,255,0.10)" }
                                }
                              >
                                {run.status}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-white">
                              {run.started_at ? new Date(run.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"}
                            </td>
                            <td className="px-4 py-2.5 text-white">{duration}</td>
                            <td className="px-4 py-2.5 text-white max-w-xs truncate">{outputStr}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
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

export function ClaimsPanel({
  claimsData,
  loading,
  error,
  onActionComplete
}: {
  claimsData: ClaimsData | null;
  loading: boolean;
  error?: string | null;
  onActionComplete?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [expandedEvidence, setExpandedEvidence] = useState<Set<string>>(new Set());
  const [busyClaimId, setBusyClaimId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const claimById = new Map((claimsData?.claims ?? []).map((claim) => [claim.id, claim] as const));
  const reviewQueue = claimsData?.reviewQueue ?? [];

  const handleClaimAction = useCallback(
    async (claimId: string, action: ClaimAction) => {
      setBusyClaimId(claimId);

      const noteByAction: Record<ClaimAction, string> = {
        accept: "Accepted from the Lafz critic queue.",
        reject: "Rejected from the Lafz critic queue.",
        restore: "Re-opened from the Lafz critic queue."
      };

      try {
        const response = await fetch("/api/brain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "claim-action",
            claimId,
            action,
            note: noteByAction[action]
          })
        });

        const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;

        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error ?? "Could not update claim.");
        }

        setToast({
          message:
            action === "accept"
              ? "Claim accepted."
              : action === "reject"
                ? "Claim rejected."
                : "Claim reopened for review.",
          tone: "success"
        });

        onActionComplete?.();
      } catch (actionError) {
        setToast({
          message: actionError instanceof Error ? actionError.message : "Could not update claim.",
          tone: "error"
        });
      } finally {
        setBusyClaimId(null);
      }
    },
    [onActionComplete]
  );

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

  if (!claimsData || claimsData.claims.length === 0) {
    return null;
  }

  const sorted = sortClaims(claimsData.claims);
  const accepted = sorted.filter((claim) => (claim.latestPromotion?.decision ?? claim.status) === "accepted").length;
  const rejected = sorted.filter((claim) => (claim.latestPromotion?.decision ?? claim.status) === "rejected").length;
  const deferred = sorted.filter((claim) => (claim.latestPromotion?.decision ?? claim.status) === "deferred").length;
  const reviewSummary = claimsData.reviewSummary;

  const PAGE = 6;
  const visible = showAll ? sorted : sorted.slice(0, PAGE);
  const hasMore = sorted.length > PAGE;

  function toggleEvidence(id: string) {
    setExpandedEvidence((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <>
      {toast ? <FloatingToast message={toast.message} tone={toast.tone} /> : null}
      <div className="rounded-2xl p-4 flex flex-col gap-3" style={{ background: "rgba(6,2,5,0.92)", border: "1px solid rgba(255,20,100,0.20)", boxShadow: "0 0 12px rgba(255,20,100,0.10)" }}>
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#8a7898]">Claims</p>
          <p className="text-[11px] text-[#8a7898]">
            {claimsData.claimCount} claim{claimsData.claimCount === 1 ? "" : "s"} • {accepted} accepted • {deferred} deferred • {rejected} rejected
          </p>
        </div>

        <div
          className="flex flex-col gap-3 rounded-xl px-3 py-3"
          style={{ background: "rgba(15,8,12,0.88)", border: "1px solid rgba(96,165,250,0.18)" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#60a5fa]">Critic</p>
              <p className="mt-1 text-[12px] font-semibold text-white">
                {reviewSummary.reviewableCount > 0
                  ? `${reviewSummary.reviewableCount} items need a decision`
                  : "No immediate review items"}
              </p>
              <p className="mt-0.5 text-[11px] text-[#8a7898]">
                {reviewSummary.needsRereviewCount} need re-review • {reviewSummary.lockedCount} locked
              </p>
            </div>
            <span
              className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
              style={{
                background: reviewSummary.reviewNowCount > 0 ? "rgba(251,113,133,0.12)" : "rgba(96,165,250,0.12)",
                color: reviewSummary.reviewNowCount > 0 ? "#fb7185" : "#60a5fa",
                border: `1px solid ${reviewSummary.reviewNowCount > 0 ? "rgba(251,113,133,0.25)" : "rgba(96,165,250,0.25)"}`
              }}
            >
              avg {reviewSummary.averageReviewScore.toFixed(2)}
            </span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full border border-[rgba(251,113,133,0.20)] bg-[rgba(251,113,133,0.10)] px-2 py-0.5 text-[9px] font-semibold text-[#fb7185]">
              {reviewSummary.reviewNowCount} review now
            </span>
            <span className="rounded-full border border-[rgba(250,204,21,0.20)] bg-[rgba(250,204,21,0.10)] px-2 py-0.5 text-[9px] font-semibold text-[#facc15]">
              {reviewSummary.reviewSoonCount} review soon
            </span>
            <span className="rounded-full border border-[rgba(96,165,250,0.20)] bg-[rgba(96,165,250,0.10)] px-2 py-0.5 text-[9px] font-semibold text-[#60a5fa]">
              {reviewSummary.monitorCount} monitor
            </span>
          </div>

          {reviewQueue.length > 0 ? (
            <div className="flex flex-col gap-2">
              {reviewQueue.map((item) => {
                const claim = claimById.get(item.claimId);
                const statusStyle = getClaimStatusStyle(claim?.latestPromotion?.decision ?? claim?.status ?? item.status);
                const bandColor =
                  item.reviewBand === "high"
                    ? "#fb7185"
                    : item.reviewBand === "medium"
                      ? "#facc15"
                      : "#60a5fa";
                const busy = busyClaimId === item.claimId;
                const visibleReasons = item.reasons.slice(0, 3);

                return (
                  <div
                    key={item.claimId}
                    className="rounded-xl px-3 py-3"
                    style={{ background: "rgba(10,5,8,0.92)", border: `1px solid ${bandColor}33` }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-white leading-snug">
                          {claim ? formatClaimLabel(claim) : item.claimKey.replace(/::/g, " • ")}
                        </p>
                        <p className="mt-1 text-[10px] uppercase tracking-widest text-[#8a7898]">
                          {item.claimType.replace(/_/g, " ")} • {item.scopeType}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span
                          className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
                          style={{
                            background: statusStyle.background,
                            color: statusStyle.color,
                            border: statusStyle.border
                          }}
                        >
                          {claim?.latestPromotion?.decision ?? claim?.status ?? item.status}
                        </span>
                        <span
                          className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
                          style={{
                            background: `${bandColor}14`,
                            color: bandColor,
                            border: `1px solid ${bandColor}2a`
                          }}
                        >
                          critic {item.reviewScore.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-full border border-[rgba(255,255,255,0.10)] px-2 py-0.5 text-[9px] font-semibold text-white">
                        {item.reviewRecommendation.replace(/_/g, " ")}
                      </span>
                      {item.needsRereview && (
                        <span className="rounded-full border border-[rgba(251,113,133,0.18)] bg-[rgba(251,113,133,0.10)] px-2 py-0.5 text-[9px] font-semibold text-[#fb7185]">
                          needs rereview
                        </span>
                      )}
                      {item.learningBias !== 0 && (
                        <span className="rounded-full border border-[rgba(96,165,250,0.18)] bg-[rgba(96,165,250,0.10)] px-2 py-0.5 text-[9px] font-semibold text-[#60a5fa]">
                          bias {item.learningBias > 0 ? "+" : ""}
                          {item.learningBias.toFixed(2)}
                        </span>
                      )}
                      <span className="rounded-full border border-[rgba(255,255,255,0.10)] px-2 py-0.5 text-[9px] font-semibold text-[#8a7898]">
                        {item.evidenceCount} evidence
                      </span>
                      <span className="rounded-full border border-[rgba(255,255,255,0.10)] px-2 py-0.5 text-[9px] font-semibold text-[#8a7898]">
                        {item.sourceCount} sources
                      </span>
                    </div>

                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(8, Math.round(item.reviewScore * 100))}%`,
                          background: `linear-gradient(90deg, ${bandColor}, #ffffff66)`
                        }}
                      />
                    </div>

                    {visibleReasons.length > 0 && (
                      <div className="mt-2 flex flex-col gap-1">
                        {visibleReasons.map((reason) => (
                          <p key={reason} className="text-[11px] leading-snug text-[#8a7898]">
                            {reason}
                          </p>
                        ))}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleClaimAction(item.claimId, "accept")}
                        className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[#34d399] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ background: "rgba(52,211,153,0.10)", border: "1px solid rgba(52,211,153,0.26)" }}
                      >
                        {busy ? "Working…" : "Accept"}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleClaimAction(item.claimId, "reject")}
                        className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[#fb7185] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ background: "rgba(251,113,133,0.10)", border: "1px solid rgba(251,113,133,0.26)" }}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleClaimAction(item.claimId, "restore")}
                        className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[#60a5fa] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ background: "rgba(96,165,250,0.10)", border: "1px solid rgba(96,165,250,0.26)" }}
                      >
                        Re-open
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-[rgba(96,165,250,0.16)] bg-[rgba(96,165,250,0.06)] px-3 py-3">
              <p className="text-[11px] font-semibold text-white">No claims need immediate review.</p>
              <p className="mt-1 text-[11px] text-[#8a7898]">The critic is happy with the current claim set.</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {visible.map((claim) => {
            const displayStatus = claim.latestPromotion?.decision ?? claim.status;
            const statusStyle = getClaimStatusStyle(displayStatus);
            const allEvidence = claim.evidence;
            const evidenceExpanded = expandedEvidence.has(claim.id);
            const shownEvidence = evidenceExpanded ? allEvidence : allEvidence.slice(0, 2);
            const hasMoreEvidence = allEvidence.length > 2;
            const reviewItem = reviewQueue.find((entry) => entry.claimId === claim.id) ?? null;

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
                  {reviewItem && (
                    <span
                      className="rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest"
                      style={{
                        background: reviewItem.reviewBand === "high" ? "rgba(251,113,133,0.10)" : reviewItem.reviewBand === "medium" ? "rgba(250,204,21,0.10)" : "rgba(96,165,250,0.10)",
                        color: reviewItem.reviewBand === "high" ? "#fb7185" : reviewItem.reviewBand === "medium" ? "#facc15" : "#60a5fa",
                        borderColor: reviewItem.reviewBand === "high" ? "rgba(251,113,133,0.22)" : reviewItem.reviewBand === "medium" ? "rgba(250,204,21,0.22)" : "rgba(96,165,250,0.22)"
                      }}
                    >
                      critic {reviewItem.reviewScore.toFixed(2)}
                    </span>
                  )}
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
            onClick={() => setShowAll((v) => !v)}
            className="mt-1 w-full rounded-xl py-2 text-[11px] font-bold text-[#ff6ba8] transition hover:text-white"
            style={{ background: "rgba(255,20,100,0.08)", border: "1px solid rgba(255,20,100,0.20)" }}
          >
            {showAll ? "Show less" : `Show all ${sorted.length} claims`}
          </button>
        )}
      </div>
    </>
  );
}
