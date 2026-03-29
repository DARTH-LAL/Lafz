"use client";

import { useEffect, useState } from "react";

import type { GenerationLogEntry } from "@/features/ai/generation-log";

// ── Helpers ───────────────────────────────────────────────────────────────

function formatRelative(ts: number) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  const hr = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  if (day < 7) return `${day}d ago`;
  const d = new Date(ts);
  return (
    d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
    " at " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
  );
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function formatCost(usd: number) {
  if (usd < 0.001) return `<$0.001`;
  return `$${usd.toFixed(3)}`;
}

function ProviderBadge({ provider }: { provider: string }) {
  const map: Record<string, string> = {
    openai:    "border-[rgba(255,77,150,0.3)]  bg-[rgba(255,77,150,0.10)]  text-[#ff4d96]",
    anthropic: "border-[rgba(162,89,255,0.3)]  bg-[rgba(162,89,255,0.10)]  text-[#a259ff]",
    gemini:    "border-[rgba(64,232,255,0.3)]   bg-[rgba(64,232,255,0.10)]   text-[#40e8ff]",
    multi:     "border-[rgba(255,20,100,0.25)]  bg-[rgba(255,20,100,0.08)]  text-[#ff6aaa]",
    ollama:    "border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.5)]",
  };
  const cls = map[provider.toLowerCase()] ?? map.ollama;
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${cls}`}>
      {provider}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "saved_translation") {
    return (
      <span className="rounded-full border border-[rgba(63,255,170,0.3)] bg-[rgba(63,255,170,0.10)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#3fffaa]">
        Synced
      </span>
    );
  }
  if (status === "draft_only_plain") {
    return (
      <span className="rounded-full border border-[rgba(255,179,71,0.3)] bg-[rgba(255,179,71,0.10)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#ffb347]">
        Draft
      </span>
    );
  }
  if (status === "draft_only_preserved") {
    return (
      <span className="rounded-full border border-[rgba(64,232,255,0.3)] bg-[rgba(64,232,255,0.10)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#40e8ff]">
        Preserved
      </span>
    );
  }
  return null;
}

function ConfidenceBar({ low, medium, high, total }: { low: number; medium: number; high: number; total: number }) {
  if (total === 0) return null;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full">
      <div style={{ width: `${(high / total) * 100}%`, background: "#3fffaa" }} />
      <div style={{ width: `${(medium / total) * 100}%`, background: "#ffb347" }} />
      <div style={{ width: `${(low / total) * 100}%`, background: "#ff4d64" }} />
    </div>
  );
}

/** Mini sparkline — shows high-confidence % across runs (oldest→newest left to right) */
function QualitySparkline({ entries }: { entries: GenerationLogEntry[] }) {
  if (entries.length < 2) return null;

  // oldest first for the sparkline
  const sorted = [...entries].sort((a, b) => a.timestampMs - b.timestampMs);
  const points = sorted.map((e) => (e.lineCount > 0 ? (e.highCount / e.lineCount) * 100 : 0));
  const max = 100;
  const w = 120;
  const h = 28;
  const pad = 3;

  const xs = points.map((_, i) => pad + (i / Math.max(points.length - 1, 1)) * (w - pad * 2));
  const ys = points.map((p) => h - pad - ((p / max) * (h - pad * 2)));

  const polyline = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
  const areaPath = `M${xs[0]},${h - pad} L${xs.map((x, i) => `${x},${ys[i]}`).join(" L")} L${xs[xs.length - 1]},${h - pad} Z`;

  const last = points[points.length - 1];
  const first = points[0];
  const delta = last - first;
  const trendColor = delta >= 0 ? "#3fffaa" : "#ff4d64";

  return (
    <div className="flex items-center gap-2">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
        <defs>
          <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={trendColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={trendColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#spark-fill)" />
        <polyline points={polyline} fill="none" stroke={trendColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* last dot */}
        <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r="2.5" fill={trendColor} />
      </svg>
      <span
        className="text-[10px] font-bold"
        style={{ color: trendColor }}
      >
        {delta >= 0 ? "↑" : "↓"}{Math.abs(Math.round(delta))}%
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

type GenerationHistoryProps = {
  spotifyTrackId: string;
};

export function GenerationHistory({ spotifyTrackId }: GenerationHistoryProps) {
  const [entries, setEntries] = useState<GenerationLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/library/generation-log/${spotifyTrackId}`)
      .then((r) => r.json() as Promise<{ entries: GenerationLogEntry[] }>)
      .then((d) => setEntries(d.entries ?? []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }, [spotifyTrackId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <span className="text-[12px] text-white/50">Loading generation history…</span>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="py-6 text-center">
        <p className="text-[12px] text-white/50">No generation runs recorded yet.</p>
        <p className="mt-1 text-[11px] text-white/30">
          Each time you generate a translation, a record is saved here.
        </p>
      </div>
    );
  }

  const highPctLatest = entries[0].lineCount > 0 ? Math.round((entries[0].highCount / entries[0].lineCount) * 100) : 0;

  return (
    <div className="space-y-3">
      {/* Summary row */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-[rgba(255,20,100,0.35)] bg-[rgba(6,2,5,0.92)] shadow-[0_0_0_1px_rgba(255,20,100,0.08),0_0_18px_rgba(255,20,100,0.18)] px-4 py-3">
        <div className="flex flex-wrap gap-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(255,20,100,0.65)]">Runs</p>
            <p className="mt-0.5 text-[18px] font-bold text-white">{entries.length}</p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(255,20,100,0.65)]">Latest quality</p>
            <p className="mt-0.5 text-[18px] font-bold" style={{ color: highPctLatest >= 75 ? "#3fffaa" : highPctLatest >= 50 ? "#ffb347" : "#ff4d64" }}>
              {highPctLatest}% high
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(255,20,100,0.65)]">Latest model</p>
            <p className="mt-0.5 text-[13px] font-semibold text-white truncate max-w-[160px]">{entries[0].model}</p>
          </div>
        </div>
        <QualitySparkline entries={entries} />
      </div>

      {/* Entry list */}
      <div className="divide-y divide-[rgba(255,20,100,0.10)] rounded-[16px] border border-[rgba(255,20,100,0.35)] shadow-[0_0_0_1px_rgba(255,20,100,0.08),0_0_18px_rgba(255,20,100,0.18)] overflow-hidden">
        {entries.map((entry, i) => {
          const isExpanded = expanded === entry.id;
          const highPct = entry.lineCount > 0 ? Math.round((entry.highCount / entry.lineCount) * 100) : 0;

          return (
            <div key={entry.id}>
              <button
                onClick={() => setExpanded(isExpanded ? null : entry.id)}
                className="w-full px-4 py-3 text-left transition hover:bg-[rgba(255,20,100,0.05)]"
              >
                <div className="flex items-center justify-between gap-3">
                  {/* Left: index + badges */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 text-center text-[10px] font-bold text-white/40">
                      {entries.length - i}
                    </span>
                    <ProviderBadge provider={entry.provider} />
                    <StatusBadge status={entry.resultStatus} />
                    {i === 0 && (
                      <span className="rounded-full bg-[rgba(255,20,100,0.2)] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[#ff6aaa]">
                        Latest
                      </span>
                    )}
                  </div>

                  {/* Right: time + chevron */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[10px] text-white/50">{formatRelative(entry.timestampMs)}</span>
                    <svg
                      viewBox="0 0 12 12"
                      className={`h-2.5 w-2.5 fill-none stroke-current text-white/50 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    >
                      <path d="M2 4l4 4 4-4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>

                {/* Model + quick stats */}
                <div className="mt-1.5 flex items-center justify-between gap-2 pl-7">
                  <p className="truncate text-[11px] text-white">{entry.model}</p>
                  <div className="flex flex-shrink-0 items-center gap-3 text-[10px]">
                    <span className="text-[rgba(255,20,100,0.65)]">{entry.lineCount} lines</span>
                    <span className="font-bold" style={{ color: highPct >= 75 ? "#3fffaa" : highPct >= 50 ? "#ffb347" : "#ff4d64" }}>
                      {highPct}% ↑
                    </span>
                    <span className="text-white/50">{formatDuration(entry.durationMs)}</span>
                  </div>
                </div>

                {/* Confidence bar */}
                <div className="mt-2 pl-7">
                  <ConfidenceBar
                    low={entry.lowCount}
                    medium={entry.mediumCount}
                    high={entry.highCount}
                    total={entry.lineCount}
                  />
                </div>
              </button>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="border-t border-[rgba(255,20,100,0.10)] bg-[rgba(255,20,100,0.03)] px-4 py-4 pl-11">
                  <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-[11px] sm:grid-cols-3 lg:grid-cols-4">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[1.6px] text-[rgba(255,20,100,0.65)]">Started</p>
                      <p className="mt-0.5 text-white">
                        {new Date(entry.startedAt).toLocaleString(undefined, {
                          month: "short", day: "numeric", year: "numeric",
                          hour: "2-digit", minute: "2-digit", second: "2-digit"
                        })}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[1.6px] text-[rgba(255,20,100,0.65)]">Duration</p>
                      <p className="mt-0.5 text-white">{formatDuration(entry.durationMs)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[1.6px] text-[rgba(255,20,100,0.65)]">Languages</p>
                      <p className="mt-0.5 text-white">
                        {entry.sourceLanguage ?? "?"} → {entry.targetLanguage}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[1.6px] text-[rgba(255,20,100,0.65)]">Lines</p>
                      <p className="mt-0.5 flex gap-2">
                        <span className="text-[#3fffaa]">↑{entry.highCount}</span>
                        <span className="text-[#ffb347]">~{entry.mediumCount}</span>
                        <span className="text-[#ff4d64]">↓{entry.lowCount}</span>
                      </p>
                    </div>
                    {entry.costSummary && (
                      <>
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-[1.6px] text-[rgba(255,20,100,0.65)]">Total cost</p>
                          <p className="mt-0.5 text-white">{formatCost(entry.costSummary.totalCostUsd)}</p>
                        </div>
                        <div className="col-span-2 sm:col-span-2">
                          <p className="text-[9px] font-bold uppercase tracking-[1.6px] text-[rgba(255,20,100,0.65)]">Pipeline</p>
                          <div className="mt-0.5 flex flex-wrap gap-3 text-[10px] text-white">
                            <span>{entry.costSummary.generatorA.model} ({formatCost(entry.costSummary.generatorA.costUsd)})</span>
                            <span>·</span>
                            <span>{entry.costSummary.generatorB.model} ({formatCost(entry.costSummary.generatorB.costUsd)})</span>
                            <span>·</span>
                            <span>{entry.costSummary.judge.model} ({formatCost(entry.costSummary.judge.costUsd)})</span>
                          </div>
                        </div>
                      </>
                    )}
                    {/* Artist profile + glossary hits */}
                    {(entry.artistProfileActive !== undefined || (entry.glossaryTermsMatched && entry.glossaryTermsMatched.length > 0)) && (
                      <div className="col-span-2 sm:col-span-3 lg:col-span-4 border-t border-[rgba(255,20,100,0.10)] pt-3 mt-1">
                        <div className="flex flex-wrap gap-x-8 gap-y-3">
                          {entry.artistProfileActive !== undefined && (
                            <div>
                              <p className="text-[9px] font-bold uppercase tracking-[1.6px] text-[rgba(255,20,100,0.65)]">Artist profile</p>
                              <div className="mt-1">
                                {entry.artistProfileActive ? (
                                  <span className="rounded-full border border-[rgba(63,255,170,0.3)] bg-[rgba(63,255,170,0.08)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#3fffaa]">
                                    Active
                                  </span>
                                ) : (
                                  <span className="rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white/40">
                                    Inactive
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                          {entry.glossaryTermsMatched && entry.glossaryTermsMatched.length > 0 && (
                            <div className="flex-1 min-w-0">
                              <p className="text-[9px] font-bold uppercase tracking-[1.6px] text-[rgba(255,20,100,0.65)]">
                                Glossary hits
                                <span className="ml-1.5 rounded-full bg-[rgba(255,20,100,0.15)] px-1.5 py-0.5 text-[8px] text-[#ff6aaa]">
                                  {entry.glossaryTermsMatched.length}
                                </span>
                              </p>
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {entry.glossaryTermsMatched.map((term) => (
                                  <span
                                    key={term}
                                    className="rounded-full border border-[rgba(162,89,255,0.25)] bg-[rgba(162,89,255,0.08)] px-2 py-0.5 text-[9px] text-[#c49fff]"
                                  >
                                    {term}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {entry.glossaryTermsMatched !== undefined && entry.glossaryTermsMatched.length === 0 && (
                            <div>
                              <p className="text-[9px] font-bold uppercase tracking-[1.6px] text-[rgba(255,20,100,0.65)]">Glossary hits</p>
                              <p className="mt-0.5 text-[10px] text-white/40">None matched</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
