"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { findActiveLineIndex } from "@/features/sync/engine";
import { formatTranslationNote } from "@/features/translations/note-format";
import type { TrackTranslation } from "@/features/translations/types";
import { cx, formatMilliseconds } from "@/lib/utils";

const waveHeights = [5, 13, 8, 11];
const waveDelays = ["0s", "0.07s", "0.14s", "0.21s"];

type LyricsPanelProps = {
  translation: TrackTranslation;
  progressMs: number;
  isPlaying: boolean;
  onSeek?: (positionMs: number) => Promise<void> | void;
};

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2">
      <div className="h-px flex-1 bg-[rgba(255,20,100,0.18)]" />
      <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[rgba(255,20,100,0.65)]">{label}</div>
      <div className="h-px flex-1 bg-[rgba(255,20,100,0.18)]" />
    </div>
  );
}

export function LyricsPanel({ translation, progressMs, isPlaying, onSeek }: LyricsPanelProps) {
  const [expandedLineIndex, setExpandedLineIndex] = useState<number | null>(null);
  const [copiedLineIndex, setCopiedLineIndex] = useState<number | null>(null);
  const lineRefs = useRef<Array<HTMLDivElement | null>>([]);

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

    activeNode.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  }, [activeLineIndex]);

  const currentLineNumber = activeLineIndex >= 0 ? activeLineIndex + 1 : 1;

  const handleCopy = async (index: number, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedLineIndex(index);
      window.setTimeout(() => {
        setCopiedLineIndex((currentValue) => (currentValue === index ? null : currentValue));
      }, 1400);
    } catch {
      setCopiedLineIndex(null);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-[rgba(255,20,100,0.20)] px-5 py-5 sm:flex-row sm:items-end sm:justify-between lg:px-8">
        <div>
          <h2 className="text-[24px] font-extrabold tracking-[-0.8px] text-[#fff0f6]">{translation.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-white">
            <span>{translation.artist}</span>
            <span className="h-1 w-1 rounded-full bg-white" />
            <div className="flex items-center gap-2 text-xs">
              <span className="rounded-md border border-[rgba(255,255,255,0.15)] bg-[rgba(6,2,5,0.92)] px-2.5 py-1 font-semibold text-white">
                {translation.sourceLanguage}
              </span>
              <span className="text-[#ff2d78] opacity-70">→</span>
              <span className="rounded-md border border-[rgba(255,20,100,0.65)] bg-[rgba(255,20,100,0.14)] px-2.5 py-1 font-semibold text-[#ff6ba8] shadow-[0_0_10px_rgba(255,20,100,0.35)]">
                {translation.targetLanguage}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]">
          <div className="rounded-full border border-[rgba(255,20,100,0.30)] bg-[rgba(6,2,5,0.92)] px-3 py-2 text-white">
            Line {currentLineNumber} of {translation.lines.length}
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,20,100,0.65)] bg-[rgba(255,20,100,0.14)] px-3 py-2 text-[#ff6ba8] shadow-[0_0_10px_rgba(255,20,100,0.35)]">
            <span className="lafz-badge-ring h-1.5 w-1.5 rounded-full bg-[#ff1464] shadow-[0_0_6px_rgba(255,20,100,0.90)]" />
            {isPlaying ? "Live" : "Paused"}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-20 pt-4 lg:px-6 [mask-image:linear-gradient(to_bottom,transparent,black_8%,black_92%,transparent)]">
        {translation.lines.map((line, index) => {
          const isPast = activeLineIndex >= 0 && index < activeLineIndex;
          const isActive = index === activeLineIndex;
          const isUpcoming = activeLineIndex >= 0 ? index > activeLineIndex : true;
          const isExpanded = isActive || expandedLineIndex === index;
          const noteText = formatTranslationNote(line.note);

          return (
            <div key={`${line.startMs}-${index}`}>
              {index === 0 && activeLineIndex > 0 ? <SectionLabel label="Earlier" /> : null}
              {index === activeLineIndex ? <SectionLabel label="Now playing" /> : null}
              {activeLineIndex >= 0 && index === activeLineIndex + 1 ? <SectionLabel label="Coming up" /> : null}

              <div
                ref={(element) => {
                  lineRefs.current[index] = element;
                }}
                className={cx(
                  "group relative mx-1 my-1 flex cursor-pointer items-start justify-between gap-3 rounded-[16px] border px-4 py-3 transition-all duration-300 ease-out",
                  isActive
                    ? "my-3 border-[rgba(255,20,100,0.55)] bg-[rgba(6,2,5,0.92)] px-5 py-5 shadow-[0_0_0_1px_rgba(255,20,100,0.12),0_0_20px_rgba(255,20,100,0.30),0_16px_40px_rgba(0,0,0,0.60)]"
                    : "border-transparent",
                  isPast ? "opacity-25 blur-[0.3px] hover:opacity-55 hover:blur-0" : "",
                  !isActive && isUpcoming ? "opacity-40 blur-[0.2px] hover:opacity-75 hover:blur-0" : ""
                )}
                onClick={() => {
                  if (!isActive && onSeek) {
                    void onSeek(line.startMs);
                    setExpandedLineIndex(index);
                    return;
                  }

                  setExpandedLineIndex((currentIndex) => (currentIndex === index ? null : index));
                }}
              >
                {isActive ? (
                  <div className="pointer-events-none absolute left-7 right-7 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,107,168,0.55),transparent)]" />
                ) : null}

                <div className="min-w-0 flex-1">
                  {isActive ? (
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex h-[13px] items-end gap-[2px]">
                        {waveHeights.map((height, waveIndex) => (
                          <span
                            key={`${height}-${waveIndex}`}
                            className="lafz-wave-bar block w-[2.5px] rounded-[2px] bg-[linear-gradient(to_top,#ff2d78,#ff8c42)]"
                            style={{ height: `${height}px`, animationDelay: waveDelays[waveIndex] }}
                          />
                        ))}
                      </div>
                      <div className="text-[9px] font-extrabold uppercase tracking-[0.25em] text-[#ff2d78]">Playing now</div>
                    </div>
                  ) : null}

                  <p
                    className={cx(
                      "leading-[1.5] transition-all duration-300",
                      isActive
                        ? "lafz-shimmer bg-[linear-gradient(110deg,#ff2d78_0%,#ff8c42_30%,#ffb8d0_50%,#ff8c42_70%,#ff2d78_100%)] bg-[length:250%_100%] bg-clip-text text-[21px] font-bold tracking-[-0.5px] text-transparent"
                        : "text-[16px] font-semibold tracking-[-0.2px] text-[#fff0f6]"
                    )}
                  >
                    {line.translated}
                  </p>

                  {!isActive ? (
                    <p className="mt-1 text-[10px] font-medium tracking-[0.08em] text-white opacity-0 transition group-hover:opacity-100">
                      Click to jump here
                    </p>
                  ) : null}

                  {isExpanded ? (
                    <div className="mt-4 overflow-hidden border-t border-[rgba(255,20,100,0.15)] pt-4">
                      <p className="text-[16px] leading-[1.55] text-[rgba(255,20,100,0.80)]">{line.original}</p>
                      {line.transliteration ? (
                        <p className="mt-1 text-[13px] italic leading-[1.55] text-[rgba(255,20,100,0.60)]">{line.transliteration}</p>
                      ) : null}
                      {noteText ? <p className="mt-3 text-sm leading-7 text-white">{noteText}</p> : null}
                    </div>
                  ) : null}
                </div>

                <div className="flex min-w-[40px] flex-col items-end gap-3 pt-1">
                  <div
                    className={cx(
                      "text-right text-[11px] font-medium tabular-nums text-white",
                      isActive ? "bg-[linear-gradient(135deg,#ff2d78_0%,#ff8c42_100%)] bg-clip-text pt-0 font-bold text-transparent" : ""
                    )}
                  >
                    {formatMilliseconds(line.startMs)}
                  </div>

                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleCopy(index, line.translated);
                    }}
                    className={cx(
                      "inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[rgba(255,20,100,0.20)] bg-[rgba(6,2,5,0.92)] text-white opacity-0 transition hover:border-[rgba(255,45,120,0.22)] hover:bg-[rgba(255,45,120,0.09)] hover:text-[#ff6ba8] group-hover:opacity-100",
                      isActive ? "opacity-70" : "",
                      copiedLineIndex === index ? "border-[rgba(255,140,66,0.3)] bg-[rgba(255,140,66,0.12)] text-[#ff8c42] opacity-100" : ""
                    )}
                    aria-label="Copy translation"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
                      <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
