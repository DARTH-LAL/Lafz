"use client";

import { useEffect, useRef } from "react";

type Beat = { start: number; duration: number; confidence: number };

/**
 * Fetches Spotify audio-analysis beats for `trackId` and fires `onBeat`
 * each time the playhead crosses a beat boundary, in sync with
 * `visualProgressMs` (the smoothed clock from usePlaybackClock).
 *
 * Only fires when `isPlaying` is true. Automatically resets on seek.
 */
export function useBeatSync({
  trackId,
  visualProgressMs,
  isPlaying,
  onBeat,
}: {
  trackId: string | null;
  visualProgressMs: number;
  isPlaying: boolean;
  onBeat: () => void;
}) {
  const beatsRef           = useRef<Beat[]>([]);
  const lastBeatIdxRef     = useRef<number>(-1);
  const onBeatRef          = useRef(onBeat);
  const rafRef             = useRef<number | null>(null);
  const progressRef        = useRef(visualProgressMs);
  const isPlayingRef       = useRef(isPlaying);
  const prevProgressRef    = useRef(visualProgressMs);

  // Keep refs up-to-date without restarting effects
  useEffect(() => { onBeatRef.current = onBeat; });
  useEffect(() => {
    // Detect seeks: if progress jumps > 2s in either direction, reset beat cursor
    const diff = Math.abs(visualProgressMs - prevProgressRef.current);
    if (diff > 2_000) {
      lastBeatIdxRef.current = -1;
    }
    prevProgressRef.current  = visualProgressMs;
    progressRef.current      = visualProgressMs;
  }, [visualProgressMs]);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  // Fetch beats whenever the track changes
  useEffect(() => {
    if (!trackId) {
      beatsRef.current     = [];
      lastBeatIdxRef.current = -1;
      return;
    }

    beatsRef.current     = [];
    lastBeatIdxRef.current = -1;

    void fetch(`/api/spotify/audio-analysis?trackId=${trackId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { beats: Beat[] } | null) => {
        if (data?.beats && data.beats.length > 0) {
          // Only use high-confidence beats (≥ 0.4) to avoid ghost pulses
          beatsRef.current = data.beats.filter((b) => b.confidence >= 0.4);
          lastBeatIdxRef.current = -1;
        }
      })
      .catch(() => {
        // Silently fail — beat sync is a nice-to-have
      });
  }, [trackId]);

  // rAF loop — detect beat crossings
  useEffect(() => {
    function tick() {
      if (isPlayingRef.current && beatsRef.current.length > 0) {
        const nowSec = progressRef.current / 1000;
        const beats  = beatsRef.current;
        let idx      = lastBeatIdxRef.current;

        // Advance cursor for every beat we've passed since last frame
        while (idx + 1 < beats.length && beats[idx + 1].start <= nowSec) {
          idx++;
        }

        if (idx > lastBeatIdxRef.current) {
          lastBeatIdxRef.current = idx;
          onBeatRef.current();
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []); // mount once — refs handle all live values
}
