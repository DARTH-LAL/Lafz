"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { findActiveLineIndex } from "@/features/sync/engine";
import type { TrackTranslation } from "@/features/translations/types";
import { cx, formatMilliseconds } from "@/lib/utils";

type LyricsPanelProps = {
  translation: TrackTranslation;
  progressMs: number;
  isPlaying: boolean;
};

export function LyricsPanel({ translation, progressMs, isPlaying }: LyricsPanelProps) {
  const [expandedLineIndex, setExpandedLineIndex] = useState<number | null>(null);
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeLineIndex = useMemo(
    () => findActiveLineIndex(translation.lines, progressMs),
    [progressMs, translation.lines]
  );

  useEffect(() => {
    if (activeLineIndex < 0) {
      return;
    }

    const activeNode = lineRefs.current[activeLineIndex];

    if (!activeNode) {
      return;
    }

    // Center the active line as playback moves so the lyrics feel live even though updates arrive via polling.
    activeNode.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }, [activeLineIndex]);

  return (
    <section className="rounded-[32px] border border-white/10 bg-[color:var(--lafz-panel)] p-6 shadow-[0_24px_100px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="flex flex-col gap-4 border-b border-white/8 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300/80">Synced translation</p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white">
            {translation.title}
          </h2>
          <p className="mt-2 text-base text-slate-400">
            {translation.sourceLanguage}
            {" -> "}
            {translation.targetLanguage}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.24em] text-slate-400">
          <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2">
            {translation.lines.length} synced lines
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2">
            {isPlaying ? "Live follow" : "Paused"}
          </span>
        </div>
      </div>

      <div className="mt-6 max-h-[72vh] overflow-y-auto pr-2 [mask-image:linear-gradient(to_bottom,transparent,black_8%,black_92%,transparent)]">
        <div className="space-y-3 py-10">
          {translation.lines.map((line, index) => {
            const isActive = index === activeLineIndex;
            const isExpanded = expandedLineIndex === index;
            const distance = activeLineIndex >= 0 ? Math.abs(index - activeLineIndex) : 3;
            const subdued = distance > 2 && !isExpanded && !isActive;

            return (
              <button
                key={`${line.startMs}-${index}`}
                ref={(element) => {
                  lineRefs.current[index] = element;
                }}
                type="button"
                onClick={() => {
                  setExpandedLineIndex((currentIndex) => (currentIndex === index ? null : index));
                }}
                className={cx(
                  "group block w-full rounded-[26px] border px-5 py-5 text-left transition duration-300 ease-out",
                  isActive
                    ? "border-cyan-300/35 bg-cyan-300/12 shadow-[0_20px_60px_rgba(34,211,238,0.12)]"
                    : "border-white/8 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.05]",
                  subdued ? "opacity-45" : "opacity-100"
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p
                      className={cx(
                        "font-display text-xl leading-8 transition duration-300 sm:text-2xl",
                        isActive ? "text-white" : "text-slate-200"
                      )}
                    >
                      {line.translated}
                    </p>
                    <p className="mt-3 text-xs uppercase tracking-[0.24em] text-slate-500">
                      {isExpanded ? "Tap to hide details" : "Tap to reveal original, transliteration, and note"}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] uppercase tracking-[0.22em] text-slate-400">
                    {formatMilliseconds(line.startMs)}
                  </span>
                </div>

                {isExpanded ? (
                  <div className="mt-4 space-y-3 border-t border-white/8 pt-4 text-sm text-slate-300">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Original</p>
                      <p className="mt-1 text-base text-white/90">{line.original}</p>
                    </div>

                    {line.transliteration ? (
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Transliteration</p>
                        <p className="mt-1 text-base">{line.transliteration}</p>
                      </div>
                    ) : null}

                    {line.note ? (
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">Note</p>
                        <p className="mt-1 text-base leading-7 text-slate-300">{line.note}</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
