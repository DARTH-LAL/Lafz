"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { StatePanel } from "@/components/state-panel";
import { PLAYBACK_POLL_INTERVAL_MS } from "@/features/spotify/config";
import type { PlaybackApiResponse } from "@/features/spotify/types";
import { usePlaybackClock } from "@/features/sync/use-playback-clock";
import { autoTimeTimingLines, formatTimingInput, parseTimingInput } from "@/features/timing/editor";
import type { TimingEditorDocument, TimingEditorLine } from "@/features/timing/types";
import { cx, formatMilliseconds } from "@/lib/utils";

const TAP_PREVIEW_DURATION_MS = 4_000;
const TAP_HISTORY_LIMIT = 30;

type EditableTimingLine = TimingEditorLine & {
  startInput: string;
  endInput: string;
};

type TimingEditorProps = {
  document: TimingEditorDocument | null;
};

function toEditableLine(line: TimingEditorLine): EditableTimingLine {
  return {
    ...line,
    startInput: formatTimingInput(line.startMs),
    endInput: formatTimingInput(line.endMs)
  };
}

function toTimingLine(line: EditableTimingLine): TimingEditorLine {
  return {
    order: line.order,
    original: line.original,
    translated: line.translated,
    transliteration: line.transliteration,
    note: line.note,
    startMs: parseTimingInput(line.startInput),
    endMs: parseTimingInput(line.endInput)
  };
}

function findActiveEditorLineIndex(lines: EditableTimingLine[], progressMs: number) {
  // Keep the active editor card aligned with playback by matching the live progress to the current line window.
  for (let index = 0; index < lines.length; index += 1) {
    const startMs = parseTimingInput(lines[index]?.startInput ?? "");
    const endMs = parseTimingInput(lines[index]?.endInput ?? "");

    if (startMs === null || endMs === null) {
      continue;
    }

    if (progressMs >= startMs && progressMs <= endMs) {
      return index;
    }
  }

  return -1;
}

function findNextTimedLineStart(lines: EditableTimingLine[], index: number) {
  for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
    const nextStartMs = parseTimingInput(lines[nextIndex]?.startInput ?? "");

    if (nextStartMs !== null) {
      return nextStartMs;
    }
  }

  return null;
}

function getFirstUntimedLineIndex(lines: EditableTimingLine[]) {
  return lines.findIndex((line) => parseTimingInput(line.startInput) === null);
}

function cloneEditableLines(lines: EditableTimingLine[]) {
  return lines.map((line) => ({ ...line }));
}

function isTextEntryElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

export function TimingEditor({ document }: TimingEditorProps) {
  const router = useRouter();
  const [lines, setLines] = useState<EditableTimingLine[]>(() => (document ? document.lines.map(toEditableLine) : []));
  const [tapHistory, setTapHistory] = useState<EditableTimingLine[][]>([]);
  const [playbackPayload, setPlaybackPayload] = useState<PlaybackApiResponse | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setLines(document ? document.lines.map(toEditableLine) : []);
    setTapHistory([]);
    setSaveMessage(null);
    setSaveError(null);
  }, [document]);

  const loadPlayback = useCallback(async () => {
    try {
      const response = await fetch("/api/playback", { cache: "no-store" });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Could not read Spotify playback for the timing editor.");
      }

      const payload = (await response.json()) as PlaybackApiResponse;
      setPlaybackPayload(payload);
      setPlaybackError(null);
    } catch (error) {
      setPlaybackError(error instanceof Error ? error.message : "Could not read Spotify playback for the timing editor.");
    }
  }, []);

  useEffect(() => {
    if (!document) {
      return;
    }

    void loadPlayback();
    const timer = window.setInterval(() => {
      void loadPlayback();
    }, PLAYBACK_POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [document, loadPlayback]);

  const playback = playbackPayload?.playback ?? null;
  const liveProgressMs = usePlaybackClock(playback);
  const isCurrentTrackPlaying = Boolean(playback?.track && document && playback.track.spotifyTrackId === document.spotifyTrackId);
  const activeLineIndex = useMemo(() => findActiveEditorLineIndex(lines, liveProgressMs), [lines, liveProgressMs]);
  const nextUntimedLineIndex = useMemo(() => getFirstUntimedLineIndex(lines), [lines]);
  const timedLineCount = useMemo(
    () => lines.filter((line) => parseTimingInput(line.startInput) !== null).length,
    [lines]
  );
  const untimedLineCount = lines.length - timedLineCount;

  const updateLine = useCallback((index: number, updater: (line: EditableTimingLine) => EditableTimingLine) => {
    setLines((currentLines) => currentLines.map((line, lineIndex) => (lineIndex === index ? updater(line) : line)));
  }, []);

  const stampEnd = useCallback(
    (index: number) => {
      if (!isCurrentTrackPlaying) {
        return;
      }

      const currentMs = Math.floor(liveProgressMs);
      updateLine(index, (line) => ({
        ...line,
        endInput: formatTimingInput(currentMs)
      }));
    },
    [isCurrentTrackPlaying, liveProgressMs, updateLine]
  );

  const clearTiming = useCallback(
    (index: number) => {
      updateLine(index, (line) => ({
        ...line,
        startInput: "",
        endInput: ""
      }));
    },
    [updateLine]
  );

  const undoLastTap = useCallback(() => {
    setTapHistory((currentHistory) => {
      const previousSnapshot = currentHistory[0];

      if (!previousSnapshot) {
        setSaveError("There is no recent tap to undo yet.");
        return currentHistory;
      }

      setLines(cloneEditableLines(previousSnapshot));
      setSaveError(null);
      setSaveMessage("Undid the last tap timing change.");
      return currentHistory.slice(1);
    });
  }, []);

  const tapLineStart = useCallback(
    (index: number) => {
      if (!document || !isCurrentTrackPlaying || index < 0 || index >= lines.length) {
        return;
      }

      const currentMs = Math.floor(liveProgressMs);
      setLines((currentLines) => {
        setTapHistory((currentHistory) => [cloneEditableLines(currentLines), ...currentHistory].slice(0, TAP_HISTORY_LIMIT));

        const nextLines = cloneEditableLines(currentLines);
        const line = nextLines[index];

        if (!line) {
          return currentLines;
        }

        line.startInput = formatTimingInput(currentMs);

        const nextTimedLineStart = findNextTimedLineStart(nextLines, index);
        const provisionalEndMs =
          nextTimedLineStart !== null
            ? Math.max(currentMs, nextTimedLineStart - 1)
            : Math.min(document.durationMs, currentMs + TAP_PREVIEW_DURATION_MS);
        line.endInput = formatTimingInput(provisionalEndMs);

        const previousLine = nextLines[index - 1];

        if (previousLine && parseTimingInput(previousLine.startInput) !== null) {
          previousLine.endInput = formatTimingInput(Math.max(0, currentMs - 1));
        }

        return nextLines;
      });

      setSaveError(null);
      setSaveMessage(
        nextUntimedLineIndex === index
          ? `Stamped line ${index + 1}. Press Space for the next line or keep clicking the lyrics as they start.`
          : `Stamped line ${index + 1} at ${formatTimingInput(currentMs)}.`
      );
    },
    [document, isCurrentTrackPlaying, lines.length, liveProgressMs, nextUntimedLineIndex]
  );

  const handleAutoTime = useCallback(() => {
    if (!document) {
      return;
    }

    setLines((currentLines) => autoTimeTimingLines(currentLines.map(toTimingLine), document.durationMs).map(toEditableLine));
    setSaveError(null);
    setSaveMessage(
      untimedLineCount === 0
        ? "Rebuilt the visible line ranges from the current start times so playback and saving stay in sync."
        : timedLineCount > 0
        ? `Auto-filled the remaining ${untimedLineCount} line${untimedLineCount === 1 ? "" : "s"} around your existing anchor timings.`
        : "Estimated timings for the full song. You can now spot-check the rough pass instead of stamping every line."
    );
  }, [document, timedLineCount, untimedLineCount]);

  useEffect(() => {
    if (!document) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryElement(event.target)) {
        return;
      }

      if (event.code === "Space") {
        if (!isCurrentTrackPlaying || nextUntimedLineIndex === -1) {
          return;
        }

        event.preventDefault();
        tapLineStart(nextUntimedLineIndex);
        return;
      }

      if (event.code === "Backspace") {
        event.preventDefault();
        undoLastTap();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [document, isCurrentTrackPlaying, nextUntimedLineIndex, tapLineStart, undoLastTap]);

  const handleSave = useCallback(async () => {
    if (!document) {
      return;
    }

    setIsSaving(true);
    setSaveMessage(null);
    setSaveError(null);

    try {
      const response = await fetch("/api/library/save-timed-translation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...document,
          lines: lines.map((line) => ({
            order: line.order,
            original: line.original,
            translated: line.translated,
            transliteration: line.transliteration,
            note: line.note,
            startMs: parseTimingInput(line.startInput),
            endMs: parseTimingInput(line.endInput)
          }))
        })
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        success?: boolean;
        savedLineCount?: number;
        skippedLineCount?: number;
      };

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Could not save the timed translation file.");
      }

      setSaveMessage(
        `Saved ${payload.savedLineCount ?? 0} timed line${payload.savedLineCount === 1 ? "" : "s"}${payload.skippedLineCount ? ` and skipped ${payload.skippedLineCount} untimed line${payload.skippedLineCount === 1 ? "" : "s"}.` : "."}`
      );
      router.refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save the timed translation file.");
    } finally {
      setIsSaving(false);
    }
  }, [document, lines, router]);

  if (!document) {
    return (
      <StatePanel
        eyebrow="Timing editor"
        title="Import lyrics or generate a draft first"
        description="Lafz needs either an AI draft, a synced translation file, or a local lyrics cache before the timing editor can open."
        className="mt-6"
      />
    );
  }

  return (
    <section className="mt-6 rounded-[32px] border border-white/10 bg-[color:var(--lafz-panel)] p-6 shadow-[0_24px_100px_rgba(0,0,0,0.3)] backdrop-blur-xl">
      <div className="flex flex-col gap-4 border-b border-white/8 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300/80">Timing editor</p>
          <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white">
            Turn the draft into a real playback translation.
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
            Play the same song in Spotify, then tap the line when it starts. You can click the line itself or press
            Space to stamp the next pending line. Lafz closes the previous line automatically and keeps the rest ready
            for quick cleanup.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleAutoTime}
            className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
          >
            {timedLineCount > 0 && untimedLineCount > 0
              ? `Auto-fill ${untimedLineCount} remaining line${untimedLineCount === 1 ? "" : "s"}`
              : timedLineCount === lines.length && lines.length > 0
                ? "Rebuild timing ranges"
                : "Estimate all timings"}
          </button>
          <button
            type="button"
            onClick={undoLastTap}
            disabled={tapHistory.length === 0}
            className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Undo last tap
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSave();
            }}
            disabled={isSaving}
            className="inline-flex items-center justify-center rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-cyan-300/50"
          >
            {isSaving ? "Saving translation..." : "Save timed translation"}
          </button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-[22px] border border-white/8 bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Source</p>
          <p className="mt-2 text-base text-white">{document.source.replace("_", " ")}</p>
        </div>
        <div className="rounded-[22px] border border-white/8 bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Live playback</p>
          <p className="mt-2 text-base text-white">
            {isCurrentTrackPlaying ? `Matched at ${formatTimingInput(liveProgressMs)}` : "Play this exact track in Spotify"}
          </p>
        </div>
        <div className="rounded-[22px] border border-white/8 bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Track length</p>
          <p className="mt-2 text-base text-white">{formatMilliseconds(document.durationMs)}</p>
        </div>
        <div className="rounded-[22px] border border-white/8 bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Lines</p>
          <p className="mt-2 text-base text-white">{lines.length}</p>
        </div>
        <div className="rounded-[22px] border border-white/8 bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Anchors</p>
          <p className="mt-2 text-base text-white">
            {timedLineCount} timed / {untimedLineCount} remaining
          </p>
        </div>
        <div className="rounded-[22px] border border-white/8 bg-black/10 p-4">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Next tap</p>
          <p className="mt-2 text-base text-white">
            {nextUntimedLineIndex === -1 ? "All lines timed" : `Line ${nextUntimedLineIndex + 1}`}
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-[22px] border border-white/8 bg-black/10 p-4 text-sm leading-7 text-slate-300">
        Press <span className="font-mono text-xs text-slate-100">Space</span> to stamp the next pending line, click a
        lyric line to stamp that exact one, and use <span className="font-mono text-xs text-slate-100">Backspace</span>{" "}
        to undo the last tap. If a song is still completely untimed, you can still use the estimate button for a quick
        first pass.
      </div>

      {playbackError ? (
        <div className="mt-5 rounded-[22px] border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
          {playbackError}
        </div>
      ) : null}

      {saveMessage ? (
        <div className="mt-5 rounded-[22px] border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm text-cyan-100">
          {saveMessage}
        </div>
      ) : null}

      {saveError ? (
        <div className="mt-5 rounded-[22px] border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
          {saveError}
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        {lines.map((line, index) => {
          const hasStart = parseTimingInput(line.startInput) !== null;
          const isNextTapLine = nextUntimedLineIndex === index;

          return (
            <article
              key={`${document.spotifyTrackId}-${line.order}`}
              className={cx(
                "rounded-[24px] border border-white/8 bg-black/10 p-5 transition",
                activeLineIndex === index ? "border-cyan-300/40 bg-cyan-300/10" : "",
                isNextTapLine ? "border-amber-300/35 bg-amber-300/10" : ""
              )}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                    Line {line.order + 1}
                    {isNextTapLine ? " · next tap" : ""}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      tapLineStart(index);
                    }}
                    disabled={!isCurrentTrackPlaying}
                    className="mt-2 block rounded-[18px] border border-transparent px-0 py-0 text-left text-lg text-white transition hover:text-cyan-100 disabled:cursor-not-allowed disabled:text-slate-500"
                  >
                    {line.original}
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      tapLineStart(index);
                    }}
                    disabled={!isCurrentTrackPlaying}
                    className="inline-flex items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Tap this line now
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      stampEnd(index);
                    }}
                    disabled={!isCurrentTrackPlaying}
                    className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Set end
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clearTiming(index);
                    }}
                    className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Translated</span>
                  <textarea
                    value={line.translated}
                    rows={2}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      updateLine(index, (currentLine) => ({
                        ...currentLine,
                        translated: nextValue
                      }));
                    }}
                    className="mt-3 w-full rounded-[18px] border border-white/12 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/50"
                  />
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Start</span>
                    <input
                      type="text"
                      value={line.startInput}
                      placeholder="0:12.34"
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        updateLine(index, (currentLine) => ({
                          ...currentLine,
                          startInput: nextValue
                        }));
                      }}
                      className="mt-3 w-full rounded-[18px] border border-white/12 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/50"
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">End</span>
                    <input
                      type="text"
                      value={line.endInput}
                      placeholder="0:16.40"
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        updateLine(index, (currentLine) => ({
                          ...currentLine,
                          endInput: nextValue
                        }));
                      }}
                      className="mt-3 w-full rounded-[18px] border border-white/12 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/50"
                    />
                  </label>
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Transliteration</span>
                  <input
                    type="text"
                    value={line.transliteration ?? ""}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      updateLine(index, (currentLine) => ({
                        ...currentLine,
                        transliteration: nextValue || null
                      }));
                    }}
                    className="mt-3 w-full rounded-[18px] border border-white/12 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/50"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Note</span>
                  <textarea
                    value={line.note ?? ""}
                    rows={2}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      updateLine(index, (currentLine) => ({
                        ...currentLine,
                        note: nextValue || null
                      }));
                    }}
                    className="mt-3 w-full rounded-[18px] border border-white/12 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/50"
                  />
                </label>
              </div>

              <div className="mt-3 text-xs text-slate-400">
                {hasStart
                  ? "Timed and ready to save."
                  : isNextTapLine
                    ? "Ready for the next Space press or click."
                    : "Untimed. Click the line when it starts or estimate the whole song first."}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
