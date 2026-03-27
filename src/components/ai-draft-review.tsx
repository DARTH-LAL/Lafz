"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { FloatingToast } from "@/components/floating-toast";
import type { AiTranslationDraftFile } from "@/features/ai/types";

type AiDraftReviewProps = {
  track: {
    spotifyTrackId: string;
    title: string;
    artist: string;
    album: string;
    durationMs: number;
  };
  initialDraft: AiTranslationDraftFile | null;
  lastModifiedAt: string | null;
};

type EditableDraftLine = {
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
};

type DisplayDraftLine = {
  line: EditableDraftLine;
  duplicateCount: number;
};

function toEditableDraftLine(line: AiTranslationDraftFile["lines"][number]): EditableDraftLine {
  return {
    order: line.order,
    original: line.original,
    literal: line.literal,
    natural: line.natural,
    slangAware: line.slangAware,
    chosen: line.chosen,
    transliteration: line.transliteration,
    note: line.note,
    ambiguity: line.ambiguity,
    confidence: line.confidence,
    selectorReason: line.selectorReason
  };
}

function getConfidenceBadgeClasses(confidence: EditableDraftLine["confidence"]) {
  if (confidence === "high") return "border-[rgba(63,255,170,0.25)] bg-[rgba(63,255,170,0.10)] text-[#3fffaa]";
  if (confidence === "medium") return "border-[rgba(255,160,30,0.25)] bg-[rgba(255,160,30,0.10)] text-[#ffc87a]";
  return "border-[rgba(255,20,100,0.28)] bg-[rgba(255,20,100,0.12)] text-[#ff6aaa]";
}

function normalizeReviewKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function applyManualReview(
  line: EditableDraftLine,
  overrides: Partial<Pick<EditableDraftLine, "chosen" | "transliteration" | "note">>
) {
  return { ...line, ...overrides, confidence: "high" as const, selectorReason: "Manually reviewed in Lafz." };
}

function formatUpdatedAt(value: string | null) {
  if (!value) return "Not updated yet";
  return new Date(value).toLocaleString();
}

export function AiDraftReview({ track, initialDraft, lastModifiedAt }: AiDraftReviewProps) {
  const router = useRouter();
  const [showLowConfidenceFirst, setShowLowConfidenceFirst] = useState(true);
  const [savingReviewKey, setSavingReviewKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [draftLines, setDraftLines] = useState<EditableDraftLine[]>(() =>
    initialDraft ? initialDraft.lines.map(toEditableDraftLine) : []
  );

  const lowConfidenceCount = useMemo(() => draftLines.filter((l) => l.confidence === "low").length, [draftLines]);

  const displayedDraftLines = useMemo<DisplayDraftLine[]>(() => {
    const dedupe = (lines: EditableDraftLine[]) => {
      const seen = new Map<string, DisplayDraftLine>();
      const out: DisplayDraftLine[] = [];
      for (const line of lines) {
        if (line.confidence !== "low") { out.push({ line, duplicateCount: 1 }); continue; }
        const key = normalizeReviewKey(line.original);
        if (!key) { out.push({ line, duplicateCount: 1 }); continue; }
        const existing = seen.get(key);
        if (existing) { existing.duplicateCount += 1; continue; }
        const entry = { line, duplicateCount: 1 };
        seen.set(key, entry);
        out.push(entry);
      }
      return out;
    };

    const lines = [...draftLines];
    if (!showLowConfidenceFirst) return dedupe(lines.sort((a, b) => a.order - b.order));

    lines.sort((a, b) => {
      const w = (c: EditableDraftLine["confidence"]) => c === "low" ? 0 : c === "medium" ? 1 : 2;
      const diff = w(a.confidence) - w(b.confidence);
      return diff !== 0 ? diff : a.order - b.order;
    });
    return dedupe(lines);
  }, [draftLines, showLowConfidenceFirst]);

  const updateMatchingDraftLines = (order: number, updater: (l: EditableDraftLine) => EditableDraftLine) => {
    setDraftLines((current) => {
      const src = current.find((l) => l.order === order);
      const key = src ? normalizeReviewKey(src.original) : "";
      return current.map((l) => {
        if (l.order === order) return updater(l);
        if (key && normalizeReviewKey(l.original) === key) return updater(l);
        return l;
      });
    });
  };

  const getMatchingLines = (order: number) => {
    const src = draftLines.find((l) => l.order === order);
    if (!src) return [];
    const key = normalizeReviewKey(src.original);
    if (!key) return [src];
    return draftLines.filter((l) => normalizeReviewKey(l.original) === key);
  };

  useEffect(() => {
    setDraftLines(initialDraft ? initialDraft.lines.map(toEditableDraftLine) : []);
  }, [initialDraft?.generatedAt, initialDraft?.spotifyTrackId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const handleSaveLine = async (order: number) => {
    const matchingLines = getMatchingLines(order);
    if (matchingLines.length === 0) return;
    const reviewKey = normalizeReviewKey(matchingLines[0].original) || `line-${order}`;
    setSavingReviewKey(reviewKey);

    try {
      const response = await fetch("/api/ai/save-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spotifyTrackId: track.spotifyTrackId,
          lines: matchingLines.map((l) => ({ order: l.order, chosen: l.chosen, note: l.note, transliteration: l.transliteration }))
        })
      });

      const payload = (await response.json()) as { success?: boolean; message?: string; error?: string };
      if (!response.ok || !payload.success) throw new Error(payload.error ?? "Could not save changes.");

      const msg = payload.message ?? "Saved.";
      setToast({ message: msg, tone: "success" });
      router.refresh();
    } catch (error) {
      setToast({ message: error instanceof Error ? error.message : "Could not save changes.", tone: "error" });
    } finally {
      setSavingReviewKey(null);
    }
  };

  if (draftLines.length === 0) {
    return (
      <div className="rounded-[16px] border border-[rgba(255,20,100,0.10)] bg-[rgba(255,20,100,0.04)] p-6 text-[13px] leading-[1.7] text-[#7a6890]">
        No draft available yet. Generate a draft from the track detail page first.
      </div>
    );
  }

  return (
    <>
      {toast ? <FloatingToast message={toast.message} tone={toast.tone} /> : null}

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 border-b border-[rgba(255,20,100,0.08)] pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[2.2px] text-[rgba(255,20,100,0.65)]">Draft Review</p>
          <h2 className="mt-2 text-[22px] font-bold tracking-[-0.5px]">Review the uncertain lines.</h2>
          <p className="mt-1.5 text-[13px] leading-[1.7] text-[#7a6890]">
            Low-confidence lines bubble to the top. Fixes apply across all matching lines automatically.
          </p>
          {lastModifiedAt ? (
            <p className="mt-2 text-[11px] text-[#5a4870]">Last updated: {formatUpdatedAt(lastModifiedAt)}</p>
          ) : null}
        </div>

        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <span className="rounded-full border border-[rgba(255,20,100,0.18)] bg-[rgba(255,20,100,0.07)] px-3 py-1.5 text-[11px] font-semibold text-[#ff6aaa]">
            {draftLines.length} lines
          </span>
          <span className="rounded-full border border-[rgba(255,20,100,0.18)] bg-[rgba(255,20,100,0.07)] px-3 py-1.5 text-[11px] font-semibold text-[#ff6aaa]">
            {lowConfidenceCount} low confidence
          </span>
          <button
            type="button"
            onClick={() => setShowLowConfidenceFirst((v) => !v)}
            className="rounded-full border border-[rgba(255,20,100,0.18)] bg-[rgba(255,20,100,0.07)] px-3 py-1.5 text-[11px] font-semibold text-[#ff6aaa] transition hover:bg-[rgba(255,20,100,0.14)]"
          >
            {showLowConfidenceFirst ? "Low confidence first" : "Original order"}
          </button>
        </div>
      </div>

      {/* Lines */}
      <div className="space-y-4">
        {displayedDraftLines.map(({ line, duplicateCount }) => {
          const matchingCount = getMatchingLines(line.order).length;
          const saveKey = normalizeReviewKey(line.original) || `line-${line.order}`;

          return (
            <article key={`${track.spotifyTrackId}-${line.order}`} className="rounded-[20px] border border-[rgba(255,20,100,0.10)] bg-black/20 p-5 transition hover:border-[rgba(255,20,100,0.20)]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(255,20,100,0.55)]">Line {line.order + 1}</p>
                    {duplicateCount > 1 ? (
                      <span className="rounded-full border border-[rgba(255,20,100,0.18)] bg-[rgba(255,20,100,0.07)] px-2.5 py-0.5 text-[10px] font-semibold text-[#ff6aaa]">
                        ×{duplicateCount}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 text-[16px] font-medium text-[#fff0f6]">{line.original}</p>
                </div>
                <span className={`inline-flex flex-shrink-0 rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[1.2px] ${getConfidenceBadgeClasses(line.confidence)}`}>
                  {line.confidence}
                </span>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded-[16px] border border-[rgba(255,20,100,0.10)] bg-[rgba(255,20,100,0.04)] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(255,20,100,0.55)]">Literal</p>
                  <p className="mt-2 text-[13px] leading-[1.65] text-[#c8b8d8]">{line.literal}</p>
                  <button type="button" onClick={() => updateMatchingDraftLines(line.order, (l) => applyManualReview(l, { chosen: l.literal }))}
                    className="mt-3 inline-flex rounded-full border border-[rgba(255,20,100,0.20)] bg-[rgba(255,20,100,0.08)] px-4 py-1.5 text-[11px] font-semibold text-[#ff6aaa] transition hover:bg-[rgba(255,20,100,0.16)]">
                    Use literal
                  </button>
                </div>

                <div className="rounded-[16px] border border-[rgba(255,20,100,0.10)] bg-[rgba(255,20,100,0.04)] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(255,20,100,0.55)]">Natural</p>
                  <p className="mt-2 text-[13px] leading-[1.65] text-[#c8b8d8]">{line.natural}</p>
                  <button type="button" onClick={() => updateMatchingDraftLines(line.order, (l) => applyManualReview(l, { chosen: l.natural }))}
                    className="mt-3 inline-flex rounded-full border border-[rgba(255,20,100,0.20)] bg-[rgba(255,20,100,0.09)] px-4 py-1.5 text-[11px] font-semibold text-[#fff0f6] transition hover:bg-[rgba(255,20,100,0.16)]">
                    Use natural
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-[16px] border border-[rgba(160,60,255,0.12)] bg-[rgba(160,60,255,0.05)] p-4">
                <p className="text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(160,60,255,0.55)]">Slang-aware</p>
                <p className="mt-2 text-[13px] leading-[1.65] text-[#c8b8d8]">{line.slangAware}</p>
                <button type="button" onClick={() => updateMatchingDraftLines(line.order, (l) => applyManualReview(l, { chosen: l.slangAware }))}
                  className="mt-3 inline-flex rounded-full border border-[rgba(160,60,255,0.22)] bg-[rgba(160,60,255,0.10)] px-4 py-1.5 text-[11px] font-semibold text-[#c87eff] transition hover:bg-[rgba(160,60,255,0.18)]">
                  Use slang-aware
                </button>
              </div>

              <label className="mt-4 block">
                <span className="mb-2 block text-[12px] font-bold uppercase tracking-[1px] text-[rgba(255,20,100,0.70)]">Chosen line</span>
                <textarea value={line.chosen} rows={2}
                  onChange={(e) => { const v = e.target.value; updateMatchingDraftLines(line.order, (l) => applyManualReview(l, { chosen: v })); }}
                  className="w-full rounded-[14px] border border-[rgba(255,20,100,0.16)] bg-[rgba(255,20,100,0.05)] px-4 py-3 text-[14px] text-white outline-none transition focus:border-[rgba(255,20,100,0.50)] focus:shadow-[0_0_0_3px_rgba(255,20,100,0.10)]"
                />
              </label>

              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-[12px] font-bold uppercase tracking-[1px] text-[rgba(255,20,100,0.70)]">Transliteration</span>
                  <input type="text" value={line.transliteration ?? ""}
                    onChange={(e) => { const v = e.target.value; updateMatchingDraftLines(line.order, (l) => applyManualReview(l, { transliteration: v || null })); }}
                    className="w-full rounded-[14px] border border-[rgba(255,20,100,0.16)] bg-[rgba(255,20,100,0.05)] px-4 py-3 text-[14px] text-white outline-none transition focus:border-[rgba(255,20,100,0.50)] focus:shadow-[0_0_0_3px_rgba(255,20,100,0.10)]"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-[12px] font-bold uppercase tracking-[1px] text-[rgba(255,20,100,0.70)]">Note</span>
                  <textarea value={line.note ?? ""} rows={2}
                    onChange={(e) => { const v = e.target.value; updateMatchingDraftLines(line.order, (l) => applyManualReview(l, { note: v || null })); }}
                    className="w-full rounded-[14px] border border-[rgba(255,20,100,0.16)] bg-[rgba(255,20,100,0.05)] px-4 py-3 text-[14px] text-white outline-none transition focus:border-[rgba(255,20,100,0.50)] focus:shadow-[0_0_0_3px_rgba(255,20,100,0.10)]"
                  />
                </label>
              </div>

              {line.selectorReason ? (
                <div className="mt-3 rounded-[14px] border border-[rgba(255,20,100,0.18)] bg-[rgba(255,20,100,0.07)] p-4 text-[13px] leading-[1.65]">
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(255,20,100,0.60)]">Selector reason</p>
                  <p className="text-[#c8b8d8]">{line.selectorReason}</p>
                </div>
              ) : null}

              {line.ambiguity ? (
                <div className="mt-3 rounded-[14px] border border-[rgba(255,160,30,0.20)] bg-[rgba(255,160,30,0.08)] p-4 text-[13px] leading-[1.65] text-[#ffc87a]">
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(255,160,30,0.60)]">Ambiguity</p>
                  {line.ambiguity}
                </div>
              ) : null}

              <div className="mt-4">
                <button type="button" onClick={() => { void handleSaveLine(line.order); }} disabled={savingReviewKey === saveKey}
                  className="rounded-full bg-[linear-gradient(135deg,#ff1464,#ff6aaa)] px-6 py-2.5 text-[13px] font-bold text-white shadow-[0_0_16px_rgba(255,20,100,0.35)] transition hover:opacity-90 hover:shadow-[0_0_28px_rgba(255,20,100,0.55)] disabled:cursor-not-allowed disabled:opacity-50">
                  {savingReviewKey === saveKey ? "Saving..." : matchingCount > 1 ? `Save all ${matchingCount} matching lines` : "Save line"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
