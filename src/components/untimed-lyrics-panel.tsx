"use client";

import { useState } from "react";
import Link from "next/link";

import type { PlaybackApiResponse } from "@/features/spotify/types";
import { cx } from "@/lib/utils";

type UntimedLyricsPanelProps = {
  draft: NonNullable<PlaybackApiResponse["aiDraft"]>;
  trackHref: string;
};

export function UntimedLyricsPanel({ draft, trackHref }: UntimedLyricsPanelProps) {
  const [expandedLineIndex, setExpandedLineIndex] = useState<number | null>(null);

  return (
    <section className="rounded-[32px] border border-white/10 bg-[color:var(--lafz-panel)] p-6 shadow-[0_24px_100px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="flex flex-col gap-4 border-b border-white/8 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300/80">Translation draft</p>
          <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white">Untimed reading mode</h2>
          <p className="mt-2 text-base text-slate-400">
            {draft.sourceLanguage ?? "Unknown"}
            {" -> "}
            {draft.targetLanguage ?? "English"}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-xs uppercase tracking-[0.24em] text-slate-400">
          <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2">
            {draft.lineCount} draft lines
          </span>
          <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2">Not synced</span>
        </div>
      </div>

      <div className="mt-5 rounded-[22px] border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm leading-7 text-cyan-100">
        Lafz found a translation draft for this song, but the lyrics do not have timestamps yet. So for now it shows
        the translation as a plain reading view instead of karaoke-style synced lines.
        <div className="mt-4">
          <Link
            href={trackHref}
            className="inline-flex items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/15"
          >
            Open track detail
          </Link>
        </div>
      </div>

      <div className="mt-6 max-h-[72vh] overflow-y-auto pr-2">
        <div className="space-y-3 pb-4">
          {draft.lines.map((line, index) => {
            const isExpanded = expandedLineIndex === index;

            return (
              <button
                key={`${line.order}-${index}`}
                type="button"
                onClick={() => {
                  setExpandedLineIndex((currentIndex) => (currentIndex === index ? null : index));
                }}
                className={cx(
                  "block w-full rounded-[26px] border border-white/8 bg-white/[0.03] px-5 py-5 text-left transition duration-300 ease-out hover:border-white/15 hover:bg-white/[0.05]",
                  isExpanded ? "border-cyan-300/30 bg-cyan-300/10" : ""
                )}
              >
                <p className="font-display text-xl leading-8 text-slate-100 sm:text-2xl">{line.translated}</p>
                <p className="mt-3 text-xs uppercase tracking-[0.24em] text-slate-500">
                  {isExpanded ? "Tap to hide details" : "Tap to reveal original, transliteration, and note"}
                </p>

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
