"use client";

import { useEffect, useRef, useState } from "react";

type Beat = { start: number; duration: number; confidence: number };

/**
 * Fires onBeat() on every beat, using one of two strategies:
 *  1. Exact timestamps from Spotify audio-analysis (most accurate)
 *  2. BPM metronome from Spotify audio-features (fallback)
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
  const onBeatRef   = useRef(onBeat);
  const onBpmRef    = useRef(onBpmLoaded);
  const progressRef = useRef(visualProgressMs);

  useEffect(() => { onBeatRef.current = onBeat; });
  useEffect(() => { onBpmRef.current  = onBpmLoaded; });
  useEffect(() => { progressRef.current = visualProgressMs; }, [visualProgressMs]);

  // beats[] drives strategy A; bpm drives strategy B
  const [beats, setBeats] = useState<Beat[]>([]);
  const [bpm,   setBpm]   = useState<number>(120);

  // Fetch beat data when track changes
  useEffect(() => {
    if (!trackId) return;
    setBeats([]);
    setBpm(120);

    void (async () => {
      try {
        // Strategy A: exact beat timestamps
        const analysisRes  = await fetch(`/api/spotify/audio-analysis?trackId=${trackId}`);
        const analysisData = analysisRes.ok
          ? (await analysisRes.json() as { beats?: Beat[]; _spotifyStatus?: number })
          : null;

        if (analysisData?._spotifyStatus) {
          console.warn(`[lafz] audio-analysis blocked by Spotify (${analysisData._spotifyStatus})`);
        }

        if (analysisData?.beats && analysisData.beats.length > 0) {
          setBeats(analysisData.beats);
          const sample = analysisData.beats.slice(0, 16).map((b) => b.duration);
          const avgDur = sample.reduce((a, b) => a + b, 0) / sample.length;
          const derivedBpm = 60 / avgDur;
          setBpm(derivedBpm);
          onBpmRef.current?.(derivedBpm);
          console.log(`[lafz] ${analysisData.beats.length} beats, ~${derivedBpm.toFixed(1)} BPM`);
          return;
        }
      } catch { /* fall through */ }

      try {
        // Strategy B: BPM from audio-features
        const featRes  = await fetch(`/api/spotify/audio-features?trackId=${trackId}`);
        const featData = featRes.ok
          ? (await featRes.json() as { tempo?: number; _spotifyStatus?: number })
          : null;
        const tempo = featData?.tempo;
        if (tempo && tempo > 40) {
          setBpm(tempo);
          onBpmRef.current?.(tempo);
          console.log(`[lafz] BPM ${tempo.toFixed(1)} (feat) spotify=${featData?._spotifyStatus ?? "ok"}`);
        }
      } catch { /* stick with 120 */ }
    })();
  }, [trackId]);

  // Playback engine — restarts whenever isPlaying, trackId, beats, or bpm change
  useEffect(() => {
    if (!isPlaying || !trackId) return;

    // ── Strategy A: rAF beat-crossing detection ────────────────────────
    if (beats.length > 0) {
      let lastIdx = -1;
      let rafId: number;

      const tick = () => {
        const posS = progressRef.current / 1000;
        // Binary search for current beat
        let lo = 0, hi = beats.length - 1, idx = -1;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (beats[mid].start <= posS) { idx = mid; lo = mid + 1; }
          else { hi = mid - 1; }
        }
        if (idx !== lastIdx && idx >= 0) {
          lastIdx = idx;
          onBeatRef.current();
        }
        rafId = requestAnimationFrame(tick);
      };

      rafId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafId);
    }

    // ── Strategy B: BPM metronome ──────────────────────────────────────
    const beatMs  = (60 / bpm) * 1000;
    const phase   = progressRef.current % beatMs;
    const delayMs = beatMs - phase;

    let interval: ReturnType<typeof setInterval> | null = null;
    const timer = setTimeout(() => {
      onBeatRef.current();
      interval = setInterval(() => onBeatRef.current(), beatMs);
    }, delayMs);

    return () => {
      clearTimeout(timer);
      if (interval) clearInterval(interval);
    };
  }, [isPlaying, trackId, beats, bpm]);
}
