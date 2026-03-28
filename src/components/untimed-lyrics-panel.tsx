"use client";

import { useState } from "react";
import Link from "next/link";

import type { PlaybackApiResponse } from "@/features/spotify/types";
import { cx } from "@/lib/utils";

type UntimedLyricsPanelProps = {
  draft: NonNullable<PlaybackApiResponse["aiDraft"]>;
  trackTitle: string;
  trackArtist: string;
  trackHref: string;
};

export function UntimedLyricsPanel({ draft, trackTitle, trackArtist, trackHref }: UntimedLyricsPanelProps) {
  const [expandedLineIndex, setExpandedLineIndex] = useState<number | null>(null);
  const [copiedLineIndex, setCopiedLineIndex] = useState<number | null>(null);

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
      <div className="flex flex-col gap-4 border-b border-[rgba(255,20,100,0.15)] px-5 py-5 sm:flex-row sm:items-end sm:justify-between lg:px-8">
        <div>
          <h2 className="text-[24px] font-extrabold tracking-[-0.8px] text-[#fff0f6]">{trackTitle}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-white">
            <span>{trackArtist}</span>
            <span className="h-1 w-1 rounded-full bg-white/30" />
            <div className="flex items-center gap-2 text-xs">
              <span className="rounded-md border border-[rgba(255,255,255,0.12)] bg-[rgba(6,2,5,0.92)] px-2.5 py-1 font-semibold text-white">
                {draft.sourceLanguage ?? "Unknown"}
              </span>
              <span className="text-[#ff2d78] opacity-70">→</span>
              <span className="rounded-md border border-[rgba(255,45,120,0.22)] bg-[rgba(255,45,120,0.09)] px-2.5 py-1 font-semibold text-[#ff6ba8]">
                {draft.targetLanguage ?? "English"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]">
          <div className="rounded-full border border-[rgba(255,255,255,0.12)] bg-[rgba(6,2,5,0.92)] px-3 py-2 text-white">
            {draft.lineCount} draft lines
          </div>
          <div className="rounded-full border border-[rgba(255,45,120,0.22)] bg-[rgba(255,45,120,0.09)] px-3 py-2 text-[#ff6ba8]">
            Reading mode
          </div>
        </div>
      </div>

      <div className="px-5 pt-5 lg:px-8">
        <div className="rounded-[20px] border border-[rgba(255,45,120,0.22)] bg-[rgba(255,45,120,0.09)] p-4 text-sm leading-7 text-[#fff0f6]">
          Lafz found a translation draft for this song, but the lyrics do not have timestamps yet. So for now it shows
          the translation as a plain reading view instead of karaoke-style synced lines.
          <div className="mt-4">
            <Link
              href={trackHref}
              className="inline-flex items-center justify-center rounded-full border border-[rgba(255,45,120,0.22)] bg-[rgba(255,45,120,0.09)] px-4 py-2 text-sm font-semibold text-[#fff0f6] transition hover:bg-[rgba(255,45,120,0.14)]"
            >
              Open track detail
            </Link>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-20 pt-4 lg:px-6">
        {draft.lines.map((line, index) => {
          const isExpanded = expandedLineIndex === index;

          return (
            <div
              key={`${line.order}-${index}`}
              className={cx(
                "group relative mx-1 my-2 cursor-pointer rounded-[16px] border border-[rgba(255,20,100,0.12)] bg-[rgba(6,2,5,0.92)] px-4 py-4 transition hover:border-[rgba(255,20,100,0.25)] hover:bg-[rgba(255,20,100,0.05)]",
                isExpanded ? "border-[rgba(255,20,100,0.30)]" : ""
              )}
              onClick={() => {
                setExpandedLineIndex((currentIndex) => (currentIndex === index ? null : index));
              }}
            >
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void handleCopy(index, line.translated);
                }}
                className={cx(
                  "absolute right-3 top-4 inline-flex h-7 w-7 items-center justify-center rounded-[8px] border border-[rgba(255,255,255,0.10)] bg-[rgba(6,2,5,0.92)] text-white opacity-0 transition hover:border-[rgba(255,20,100,0.30)] hover:bg-[rgba(255,20,100,0.09)] hover:text-[#ff6ba8] group-hover:opacity-100",
                  copiedLineIndex === index ? "border-[rgba(255,140,66,0.3)] bg-[rgba(255,140,66,0.12)] text-[#ff8c42] opacity-100" : ""
                )}
                aria-label="Copy translation"
              >
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
                  <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                </svg>
              </button>

              <p className="pr-8 text-[17px] font-semibold leading-[1.5] tracking-[-0.2px] text-[#fff0f6]">{line.translated}</p>
              <p className="mt-2 text-[10px] font-medium tracking-[0.08em] text-white">
                {isExpanded ? "Click to hide original" : "Click to expand original"}
              </p>

              {isExpanded ? (
                <div className="mt-4 border-t border-[rgba(255,20,100,0.15)] pt-4 text-sm text-white">
                  <p className="leading-[1.55] text-white">{line.original}</p>
                  {line.transliteration ? (
                    <p className="mt-1 text-[13px] italic leading-[1.55] text-white/70">{line.transliteration}</p>
                  ) : null}
                  {line.note ? <p className="mt-3 leading-7 text-white">{line.note}</p> : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
