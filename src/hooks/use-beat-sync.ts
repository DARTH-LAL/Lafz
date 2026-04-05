"use client";

import { useEffect, useRef } from "react";

/**
 * Fetches BPM via Spotify audio-features and runs a metronome
 * synced to the playback position. Fires onBeat() every beat.
 * Automatically starts/stops with isPlaying.
 */
export function useBeatSync({
  trackId,
  visualProgressMs,
  isPlaying,
  onBeat,
  onBpmLoaded,
}: {
  trackId: string | null;
  visualProgressMs: number;
  isPlaying: boolean;
  onBeat: () => void;
  onBpmLoaded?: (bpm: number) => void;
}) {
  const onBeatRef      = useRef(onBeat);
  const onBpmLoadedRef = useRef(onBpmLoaded);
  const progressRef    = useRef(visualProgressMs);
  const bpmRef         = useRef<number>(120);

  // Keep refs current on every render
  useEffect(() => { onBeatRef.current = onBeat; });
  useEffect(() => { onBpmLoadedRef.current = onBpmLoaded; });
  useEffect(() => { progressRef.current = visualProgressMs; }, [visualProgressMs]);

  // Fetch BPM when track changes
  useEffect(() => {
    if (!trackId) return;
    bpmRef.current = 120; // reset to default while loading

    void fetch(`/api/spotify/audio-features?trackId=${trackId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { tempo?: number } | null) => {
        if (data?.tempo && data.tempo > 40) {
          bpmRef.current = data.tempo;
          onBpmLoadedRef.current?.(data.tempo);
          console.log(`[lafz] BPM ${data.tempo.toFixed(1)}`);
        }
      })
      .catch(() => {});
  }, [trackId]);

  // Metronome: start when playing, stop when paused
  useEffect(() => {
    if (!isPlaying || !trackId) return;

    const beatMs = () => (60 / bpmRef.current) * 1000;

    // Phase-align to current position
    const phase        = progressRef.current % beatMs();
    const delayMs      = beatMs() - phase;

    let interval: ReturnType<typeof setInterval> | null = null;

    const firstBeat = setTimeout(() => {
      onBeatRef.current();
      interval = setInterval(() => {
        onBeatRef.current();
      }, beatMs());
    }, delayMs);

    return () => {
      clearTimeout(firstBeat);
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, trackId]); // restart metronome when track or play state changes
}
