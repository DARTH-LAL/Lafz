"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FloatingToast } from "@/components/floating-toast";
import type { AiTranslationDraftFile } from "@/features/ai/types";

// ── Types ─────────────────────────────────────────────────────────────────

type DraftLine = {
  order: number;
  original: string;
  literal: string;
  natural: string;
  slangAware: string;
  chosen: string;
  transliteration: string | null;
  note: string | null;
  ambiguity: string | null;
  confidence: "low" | "medium" | "high";
  selectorReason: string | null;
  startMs: number | null;
  endMs: number | null;
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

type FilterMode = "all" | "low" | "medium" | "high";

// ── Helpers ───────────────────────────────────────────────────────────────

function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fromDraft(line: AiTranslationDraftFile["lines"][number]): DraftLine {
  return {
    order: line.order,
    original: line.original,
    literal: line.literal,
    natural: line.natural,
    slangAware: line.slangAware,
    chosen: line.chosen,
    transliteration: line.transliteration,
    note: line.note,
    ambiguity: line.ambiguity ?? null,
    confidence: line.confidence,
    selectorReason: line.selectorReason,
    startMs: line.startMs ?? null,
    endMs: line.endMs ?? null,
  };
}

const CONFIDENCE_STYLES: Record<DraftLine["confidence"], { border: string; badge: string; dot: string }> = {
  low:    { border: "border-l-[#ff1464]",   badge: "border-[rgba(255,20,100,0.28)]  bg-[rgba(255,20,100,0.12)]  text-[#ff6aaa]",  dot: "bg-[#ff4d64]" },
  medium: { border: "border-l-[#ffb347]",   badge: "border-[rgba(255,160,30,0.25)]  bg-[rgba(255,160,30,0.10)]  text-[#ffc87a]",  dot: "bg-[#ffb347]" },
  high:   { border: "border-l-[#3fffaa]",   badge: "border-[rgba(63,255,170,0.25)]  bg-[rgba(63,255,170,0.10)]  text-[#3fffaa]",  dot: "bg-[#3fffaa]" },
};

function formatMs(ms: number) {
  const s = Math.floor(ms / 1000);
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

// ── Auto-sizing textarea ──────────────────────────────────────────────────

function AutoTextarea({
  value,
  onChange,
  onBlur,
  onKeyDown,
  placeholder,
  className,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [value]);

  useEffect(() => {
    if (autoFocus && ref.current) ref.current.focus();
  }, [autoFocus]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      className={className}
      style={{ resize: "none", overflow: "hidden" }}
    />
  );
}

// ── Expanded row (editing) ────────────────────────────────────────────────

function ExpandedRow({
  line,
  onUpdate,
  onSave,
  onClose,
  saveStatus,
  matchCount,
}: {
  line: DraftLine;
  onUpdate: (fields: Partial<Pick<DraftLine, "chosen" | "transliteration" | "note">>) => void;
  onSave: () => void;
  onClose: () => void;
  saveStatus: SaveStatus;
  matchCount: number;
}) {
  const styles = CONFIDENCE_STYLES[line.confidence];

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { onSave(); }
  }

  return (
    <div className={`border-l-2 ${styles.border} bg-[rgba(255,20,100,0.04)] px-5 py-4`}>
      {/* AI alternatives */}
      <div className="mb-3 flex flex-wrap gap-2">
        <span className="self-center text-[10px] font-bold uppercase tracking-[1.5px] text-[rgba(255,255,255,0.25)]">Pick:</span>
        {[
          { label: "Literal", value: line.literal, color: "border-[rgba(255,20,100,0.22)] bg-[rgba(255,20,100,0.08)] text-[#ff6aaa] hover:bg-[rgba(255,20,100,0.16)]" },
          { label: "Natural", value: line.natural, color: "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.09)]" },
          { label: "Slang-aware", value: line.slangAware, color: "border-[rgba(162,89,255,0.25)] bg-[rgba(162,89,255,0.10)] text-[#c87eff] hover:bg-[rgba(162,89,255,0.18)]" },
        ].map(({ label, value, color }) => (
          <button
            key={label}
            type="button"
            onClick={() => onUpdate({ chosen: value })}
            title={value}
            className={`max-w-[260px] truncate rounded-full border px-3 py-1 text-[11px] font-semibold transition ${color} ${line.chosen === value ? "ring-1 ring-white/20" : ""}`}
          >
            {label}: {value}
          </button>
        ))}
      </div>

      {/* Chosen textarea */}
      <AutoTextarea
        value={line.chosen}
        onChange={(v) => onUpdate({ chosen: v })}
        onKeyDown={handleKeyDown}
        autoFocus
        placeholder="Type your translation…"
        className="w-full rounded-[12px] border border-[rgba(255,20,100,0.22)] bg-[rgba(255,20,100,0.06)] px-4 py-2.5 text-[14px] text-white outline-none transition focus:border-[rgba(255,20,100,0.50)] focus:shadow-[0_0_0_3px_rgba(255,20,100,0.10)]"
      />

      {/* Transliteration + Note row */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input
          type="text"
          value={line.transliteration ?? ""}
          onChange={(e) => onUpdate({ transliteration: e.target.value || null })}
          placeholder="Transliteration (optional)"
          className="rounded-[10px] border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-[12px] text-white outline-none transition focus:border-[rgba(255,20,100,0.35)] placeholder:text-[#5a4870]"
        />
        <input
          type="text"
          value={line.note ?? ""}
          onChange={(e) => onUpdate({ note: e.target.value || null })}
          placeholder="Note (optional)"
          className="rounded-[10px] border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-[12px] text-white outline-none transition focus:border-[rgba(255,20,100,0.35)] placeholder:text-[#5a4870]"
        />
      </div>

      {/* Footer: ambiguity + selector reason + save */}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex-1 space-y-1.5">
          {line.ambiguity && (
            <p className="text-[11px] leading-[1.6] text-[#ffb347]">
              <span className="font-bold">⚠ Ambiguity:</span> {line.ambiguity}
            </p>
          )}
          {line.selectorReason && (
            <p className="text-[11px] leading-[1.6] text-[rgba(255,255,255,0.3)]">
              <span className="font-bold text-[rgba(255,255,255,0.4)]">Judge:</span> {line.selectorReason}
            </p>
          )}
          {line.startMs !== null && (
            <p className="text-[10px] text-[rgba(255,255,255,0.2)]">
              {formatMs(line.startMs)} → {line.endMs !== null ? formatMs(line.endMs) : "?"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[rgba(255,255,255,0.25)]">⌘↵ to save</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[rgba(255,255,255,0.10)] px-3 py-1.5 text-[11px] text-[rgba(255,255,255,0.35)] transition hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saveStatus === "saving"}
            className="rounded-full bg-[linear-gradient(135deg,#ff1464,#ff6aaa)] px-5 py-1.5 text-[12px] font-bold text-white shadow-[0_0_14px_rgba(255,20,100,0.35)] transition hover:opacity-90 disabled:opacity-50"
          >
            {saveStatus === "saving" ? "Saving…" : matchCount > 1 ? `Save ${matchCount} lines` : "Save line"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

type TranslationEditorProps = {
  track: { spotifyTrackId: string; title: string; artist: string };
  initialDraft: AiTranslationDraftFile | null;
  lastModifiedAt: string | null;
};

export function TranslationEditor({ track, initialDraft, lastModifiedAt }: TranslationEditorProps) {
  const [lines, setLines] = useState<DraftLine[]>(() =>
    initialDraft ? initialDraft.lines.map(fromDraft) : []
  );
  const [activeOrder, setActiveOrder] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<Record<number, SaveStatus>>({});
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sortByConfidence, setSortByConfidence] = useState(true);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [globalSaving, setGlobalSaving] = useState(false);

  useEffect(() => {
    setLines(initialDraft ? initialDraft.lines.map(fromDraft) : []);
    setActiveOrder(null);
  }, [initialDraft?.spotifyTrackId, initialDraft?.generatedAt]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(t);
  }, [toast]);

  // Counts
  const counts = useMemo(() => ({
    all: lines.length,
    low: lines.filter((l) => l.confidence === "low").length,
    medium: lines.filter((l) => l.confidence === "medium").length,
    high: lines.filter((l) => l.confidence === "high").length,
  }), [lines]);

  // Filtered + sorted display lines
  const displayLines = useMemo(() => {
    let result = filter === "all" ? lines : lines.filter((l) => l.confidence === filter);
    if (sortByConfidence) {
      const w = (c: DraftLine["confidence"]) => c === "low" ? 0 : c === "medium" ? 1 : 2;
      result = [...result].sort((a, b) => w(a.confidence) - w(b.confidence) || a.order - b.order);
    } else {
      result = [...result].sort((a, b) => a.order - b.order);
    }
    return result;
  }, [lines, filter, sortByConfidence]);

  // Get all lines that share the same normalized original
  const getMatchingLines = useCallback((order: number) => {
    const src = lines.find((l) => l.order === order);
    if (!src) return [];
    const key = normalizeKey(src.original);
    if (!key) return [src];
    return lines.filter((l) => normalizeKey(l.original) === key);
  }, [lines]);

  // Update a line (and all matching lines)
  function updateLine(order: number, fields: Partial<Pick<DraftLine, "chosen" | "transliteration" | "note">>) {
    setLines((prev) => {
      const src = prev.find((l) => l.order === order);
      const key = src ? normalizeKey(src.original) : "";
      return prev.map((l) => {
        const matches = l.order === order || (!!key && normalizeKey(l.original) === key);
        if (!matches) return l;
        return { ...l, ...fields, confidence: "high" as const, selectorReason: "Manually reviewed in Lafz." };
      });
    });
  }

  // Save a single line (and all matches) to the server
  async function saveLine(order: number) {
    const matching = getMatchingLines(order);
    if (matching.length === 0) return;

    // Snapshot current state of matching lines
    const currentLines = lines.filter((l) => {
      if (l.order === order) return true;
      const src = lines.find((x) => x.order === order);
      if (!src) return false;
      const key = normalizeKey(src.original);
      return key && normalizeKey(l.original) === key;
    });

    setSaveStatus((s) => ({ ...s, [order]: "saving" }));
    try {
      const res = await fetch("/api/ai/save-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spotifyTrackId: track.spotifyTrackId,
          lines: currentLines.map((l) => ({
            order: l.order,
            chosen: l.chosen,
            note: l.note,
            transliteration: l.transliteration,
          })),
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? "Save failed");
      setSaveStatus((s) => ({ ...s, [order]: "saved" }));
      setActiveOrder(null);
      setTimeout(() => setSaveStatus((s) => { const n = { ...s }; delete n[order]; return n; }), 1800);
    } catch (err) {
      setSaveStatus((s) => ({ ...s, [order]: "error" }));
      setToast({ message: err instanceof Error ? err.message : "Save failed", tone: "error" });
    }
  }

  // Save ALL lines at once
  async function saveAll() {
    setGlobalSaving(true);
    try {
      const res = await fetch("/api/ai/save-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spotifyTrackId: track.spotifyTrackId,
          lines: lines.map((l) => ({
            order: l.order,
            chosen: l.chosen,
            note: l.note,
            transliteration: l.transliteration,
          })),
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? "Save failed");
      setToast({ message: `All ${lines.length} lines saved.`, tone: "success" });
      setActiveOrder(null);
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Save failed", tone: "error" });
    } finally {
      setGlobalSaving(false);
    }
  }

  if (lines.length === 0) {
    return (
      <div className="rounded-[16px] border border-[rgba(255,20,100,0.10)] bg-[rgba(255,20,100,0.04)] p-8 text-center text-[14px] text-[#7a6890]">
        No draft available. Generate an AI translation from the track page first.
      </div>
    );
  }

  return (
    <>
      {toast && <FloatingToast message={toast.message} tone={toast.tone} />}

      {/* ── Toolbar ── */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Filter pills */}
          {(["all", "low", "medium", "high"] as FilterMode[]).map((f) => {
            const colorMap: Record<FilterMode, string> = {
              all:    "border-[rgba(255,20,100,0.22)]  bg-[rgba(255,20,100,0.10)]  text-[#ff6aaa]",
              low:    "border-[rgba(255,77,100,0.28)]   bg-[rgba(255,20,100,0.12)]  text-[#ff6aaa]",
              medium: "border-[rgba(255,160,30,0.28)]   bg-[rgba(255,160,30,0.12)] text-[#ffc87a]",
              high:   "border-[rgba(63,255,170,0.25)]   bg-[rgba(63,255,170,0.10)] text-[#3fffaa]",
            };
            const inactiveClass = "border-[rgba(255,255,255,0.09)] bg-[rgba(255,255,255,0.03)] text-[rgba(255,255,255,0.4)] hover:text-white";
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[1px] transition ${filter === f ? colorMap[f] : inactiveClass}`}
              >
                {f === "all" ? `All · ${counts.all}` : `${f} · ${counts[f]}`}
              </button>
            );
          })}

          {/* Sort toggle */}
          <button
            onClick={() => setSortByConfidence((v) => !v)}
            className="rounded-full border border-[rgba(255,255,255,0.09)] bg-[rgba(255,255,255,0.03)] px-3 py-1.5 text-[11px] font-semibold text-[rgba(255,255,255,0.45)] transition hover:text-white"
          >
            {sortByConfidence ? "↑ Confidence order" : "↕ Original order"}
          </button>
        </div>

        <div className="flex items-center gap-2">
          {lastModifiedAt && (
            <span className="text-[11px] text-[rgba(255,255,255,0.2)]">
              Last saved: {new Date(lastModifiedAt).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={saveAll}
            disabled={globalSaving}
            className="inline-flex items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#ff1464,#ff6aaa)] px-5 py-2 text-[12px] font-bold text-white shadow-[0_0_16px_rgba(255,20,100,0.3)] transition hover:opacity-90 disabled:opacity-50"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 2H4L2 4v10h12V4l-1-2z" /><rect x="5" y="9" width="6" height="5" /><rect x="5" y="2" width="5" height="4" />
            </svg>
            {globalSaving ? "Saving…" : "Save all"}
          </button>
        </div>
      </div>

      {/* ── Table header ── */}
      <div className="mb-2 grid grid-cols-[20px_1fr_1fr_80px] gap-3 px-4 text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(255,20,100,0.55)]">
        <span />
        <span>Original</span>
        <span>Translation</span>
        <span className="text-center">Confidence</span>
      </div>

      {/* ── Lines ── */}
      <div className="overflow-hidden rounded-[20px] border border-[rgba(255,20,100,0.12)]">
        {displayLines.map((line, idx) => {
          const isActive = activeOrder === line.order;
          const status = saveStatus[line.order] ?? "idle";
          const styles = CONFIDENCE_STYLES[line.confidence];
          const matchCount = getMatchingLines(line.order).length;
          const isLast = idx === displayLines.length - 1;

          return (
            <div key={line.order}>
              {/* Compact row */}
              <div
                className={[
                  "grid grid-cols-[20px_1fr_1fr_80px] gap-3 px-4 py-3 transition-colors",
                  !isLast ? "border-b border-[rgba(255,255,255,0.04)]" : "",
                  isActive ? "bg-[rgba(255,20,100,0.06)]" : "bg-[rgba(6,4,16,0.6)] hover:bg-[rgba(255,20,100,0.04)]",
                ].join(" ")}
              >
                {/* Confidence dot */}
                <div className="flex items-center justify-center pt-0.5">
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${styles.dot}`} />
                </div>

                {/* Original */}
                <div className="flex items-start">
                  <p className="text-[13px] leading-[1.55] text-[#c8b8d8]">{line.original}</p>
                </div>

                {/* Translation — click to edit */}
                <div className="flex items-start">
                  {status === "saved" ? (
                    <span className="flex items-center gap-1.5 text-[12px] text-[#3fffaa]">
                      <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <polyline points="2,7 5.5,10.5 12,3.5" />
                      </svg>
                      Saved
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveOrder(isActive ? null : line.order)}
                      className={[
                        "w-full text-left text-[13px] leading-[1.55] transition",
                        line.chosen
                          ? "text-[#fff0f6] hover:text-[#ffb0d0]"
                          : "italic text-[rgba(255,255,255,0.25)] hover:text-[rgba(255,255,255,0.5)]",
                        isActive ? "text-[#ffb0d0]" : ""
                      ].join(" ")}
                    >
                      {line.chosen || "Click to add translation…"}
                    </button>
                  )}
                </div>

                {/* Confidence badge */}
                <div className="flex items-center justify-center">
                  <span className={`rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[1px] ${styles.badge}`}>
                    {line.confidence}
                  </span>
                </div>
              </div>

              {/* Expanded editing area */}
              {isActive && (
                <ExpandedRow
                  line={line}
                  onUpdate={(fields) => updateLine(line.order, fields)}
                  onSave={() => { void saveLine(line.order); }}
                  onClose={() => setActiveOrder(null)}
                  saveStatus={status}
                  matchCount={matchCount}
                />
              )}
            </div>
          );
        })}
      </div>

      {displayLines.length === 0 && (
        <div className="mt-4 rounded-[14px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-6 text-center text-[13px] text-[rgba(255,255,255,0.3)]">
          No {filter} confidence lines.
        </div>
      )}
    </>
  );
}
