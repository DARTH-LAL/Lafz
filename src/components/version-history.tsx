"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { DraftVersion } from "@/features/ai/versioning";

// ── Helpers ───────────────────────────────────────────────────────────────

function formatDate(ts: number) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
    " at " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatRelative(ts: number) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  const hr = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  if (hr < 24) return `${hr}h ago`;
  if (day < 7) return `${day}d ago`;
  return formatDate(ts);
}

function ConfidenceBar({ low, medium, high, total }: { low: number; medium: number; high: number; total: number }) {
  if (total === 0) return null;
  const pctLow = (low / total) * 100;
  const pctMed = (medium / total) * 100;
  const pctHigh = (high / total) * 100;
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full">
      <div style={{ width: `${pctHigh}%`, background: "#3fffaa" }} />
      <div style={{ width: `${pctMed}%`, background: "#ffb347" }} />
      <div style={{ width: `${pctLow}%`, background: "#ff4d64" }} />
    </div>
  );
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

// ── Main component ────────────────────────────────────────────────────────

type VersionHistoryProps = {
  spotifyTrackId: string;
  currentGeneratedAt: string | null;
};

export function VersionHistory({ spotifyTrackId, currentGeneratedAt }: VersionHistoryProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<DraftVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringTs, setRestoringTs] = useState<number | null>(null);
  const [previewTs, setPreviewTs] = useState<number | null>(null);
  const [previewData, setPreviewData] = useState<{ lines: Array<{ original: string; chosen: string; confidence: string }> } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Load versions when panel opens
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(`/api/library/versions/${spotifyTrackId}`)
      .then((r) => r.json() as Promise<{ versions: DraftVersion[] }>)
      .then((d) => setVersions(d.versions ?? []))
      .catch(() => setVersions([]))
      .finally(() => setLoading(false));
  }, [open, spotifyTrackId, currentGeneratedAt]);

  // Load preview when a version is selected
  useEffect(() => {
    if (previewTs === null) { setPreviewData(null); return; }
    setPreviewLoading(true);
    fetch(`/api/library/versions/${spotifyTrackId}?ts=${previewTs}`)
      .then((r) => r.json())
      .then((d) => setPreviewData(d as { lines: Array<{ original: string; chosen: string; confidence: string }> }))
      .catch(() => setPreviewData(null))
      .finally(() => setPreviewLoading(false));
  }, [previewTs, spotifyTrackId]);

  async function restore(timestampMs: number) {
    setRestoringTs(timestampMs);
    try {
      const res = await fetch(`/api/library/versions/${spotifyTrackId}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ timestampMs }),
      });
      if (res.ok) {
        setOpen(false);
        setPreviewTs(null);
        router.refresh();
      }
    } finally {
      setRestoringTs(null);
    }
  }

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={[
          "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[12px] font-semibold transition",
          open
            ? "border-[rgba(162,89,255,0.4)] bg-[rgba(162,89,255,0.15)] text-[#c87eff]"
            : "border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.45)] hover:border-[rgba(162,89,255,0.3)] hover:text-[#c87eff]"
        ].join(" ")}
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.75 3.5v4.25l3 1.5-.53 1.06-3.47-1.73V4.5h1z" />
        </svg>
        Version history
        {versions.length > 0 && (
          <span className="rounded-full bg-[rgba(162,89,255,0.25)] px-1.5 py-0.5 text-[10px] font-bold text-[#c87eff]">
            {versions.length}
          </span>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 flex w-[700px] max-w-[95vw] overflow-hidden rounded-[20px] border border-[rgba(162,89,255,0.22)] bg-[rgba(8,5,20,0.97)] shadow-[0_20px_80px_rgba(0,0,0,0.7)] backdrop-blur-2xl">

          {/* Left: version list */}
          <div className="flex w-[260px] flex-shrink-0 flex-col border-r border-[rgba(162,89,255,0.12)]">
            <div className="flex items-center justify-between border-b border-[rgba(162,89,255,0.12)] px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[1.8px] text-[rgba(162,89,255,0.7)]">
                Saved versions
              </p>
              <button onClick={() => setOpen(false)} className="text-[rgba(255,255,255,0.3)] transition hover:text-white">
                <svg viewBox="0 0 14 14" className="h-3.5 w-3.5 fill-current">
                  <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading && (
                <div className="flex items-center justify-center py-10">
                  <span className="text-[12px] text-[rgba(255,255,255,0.3)]">Loading…</span>
                </div>
              )}

              {!loading && versions.length === 0 && (
                <div className="px-4 py-8 text-center">
                  <p className="text-[12px] text-[rgba(255,255,255,0.25)]">No previous versions yet.</p>
                  <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.15)]">Regenerate the translation to create a version.</p>
                </div>
              )}

              {!loading && versions.map((v, i) => (
                <button
                  key={v.timestampMs}
                  onClick={() => setPreviewTs(previewTs === v.timestampMs ? null : v.timestampMs)}
                  className={[
                    "w-full border-b border-[rgba(255,255,255,0.04)] px-4 py-3 text-left transition last:border-b-0",
                    previewTs === v.timestampMs
                      ? "bg-[rgba(162,89,255,0.12)]"
                      : "hover:bg-[rgba(162,89,255,0.06)]"
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      {i === 0 && (
                        <span className="rounded-full bg-[rgba(162,89,255,0.25)] px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-[#c87eff]">
                          Latest
                        </span>
                      )}
                      <ProviderBadge provider={v.provider} />
                    </div>
                    <span className="text-[10px] text-[rgba(255,255,255,0.25)]">{formatRelative(v.timestampMs)}</span>
                  </div>

                  <p className="mt-1.5 text-[11px] font-medium text-[rgba(255,255,255,0.6)] leading-[1.4] truncate">
                    {v.model}
                  </p>

                  <div className="mt-2 space-y-1">
                    <div className="flex justify-between text-[9px] text-[rgba(255,255,255,0.3)]">
                      <span>{v.lineCount} lines</span>
                      <span className="flex gap-2">
                        <span className="text-[#3fffaa]">↑{v.highCount}</span>
                        <span className="text-[#ffb347]">~{v.mediumCount}</span>
                        <span className="text-[#ff4d64]">↓{v.lowCount}</span>
                      </span>
                    </div>
                    <ConfidenceBar low={v.lowCount} medium={v.mediumCount} high={v.highCount} total={v.lineCount} />
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Right: preview */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {previewTs === null ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center">
                <div>
                  <div className="mb-3 text-3xl opacity-20">🕐</div>
                  <p className="text-[13px] text-[rgba(255,255,255,0.3)]">Select a version to preview</p>
                  <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.15)]">You can compare translations before restoring</p>
                </div>
              </div>
            ) : (
              <>
                {/* Preview header */}
                {(() => {
                  const v = versions.find((x) => x.timestampMs === previewTs);
                  return v ? (
                    <div className="flex items-center justify-between border-b border-[rgba(162,89,255,0.12)] px-5 py-3">
                      <div>
                        <p className="text-[12px] font-semibold text-[rgba(255,255,255,0.7)]">{formatDate(v.timestampMs)}</p>
                        <p className="mt-0.5 text-[10px] text-[rgba(255,255,255,0.3)]">{v.model} · {v.lineCount} lines</p>
                      </div>
                      <button
                        onClick={() => { void restore(previewTs); }}
                        disabled={restoringTs === previewTs}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#a259ff,#c87eff)] px-4 py-2 text-[12px] font-bold text-white shadow-[0_0_16px_rgba(162,89,255,0.35)] transition hover:opacity-90 disabled:opacity-50"
                      >
                        <svg viewBox="0 0 14 14" className="h-3 w-3 fill-current" aria-hidden="true">
                          <path d="M7 2a5 5 0 1 0 4.33 2.5L13 3V0l-3 3 .5.87A3.5 3.5 0 1 1 7 3.5V2z" />
                        </svg>
                        {restoringTs === previewTs ? "Restoring…" : "Restore this version"}
                      </button>
                    </div>
                  ) : null;
                })()}

                {/* Preview lines */}
                <div className="flex-1 overflow-y-auto">
                  {previewLoading && (
                    <div className="flex items-center justify-center py-10">
                      <span className="text-[12px] text-[rgba(255,255,255,0.3)]">Loading preview…</span>
                    </div>
                  )}
                  {!previewLoading && previewData && (
                    <div>
                      {/* Column headers */}
                      <div className="grid grid-cols-[1fr_1fr_60px] gap-3 border-b border-[rgba(255,255,255,0.05)] px-5 py-2 text-[9px] font-bold uppercase tracking-[1.5px] text-[rgba(255,255,255,0.25)]">
                        <span>Original</span>
                        <span>Translation</span>
                        <span>Conf.</span>
                      </div>
                      {previewData.lines?.map((line, i) => {
                        const confColor = line.confidence === "high" ? "#3fffaa" : line.confidence === "medium" ? "#ffb347" : "#ff4d64";
                        return (
                          <div
                            key={i}
                            className="grid grid-cols-[1fr_1fr_60px] gap-3 border-b border-[rgba(255,255,255,0.04)] px-5 py-2.5 last:border-b-0"
                          >
                            <p className="text-[12px] leading-[1.5] text-white">{line.original}</p>
                            <p className="text-[12px] leading-[1.5] text-[#fff0f6]">{line.chosen}</p>
                            <div className="flex items-center">
                              <span className="h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ background: confColor }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
