"use client";

import { useEffect, useState } from "react";

import { PLAYBACK_UI_TICK_MS } from "@/features/spotify/config";
import type { PlaybackState } from "@/features/spotify/types";
import { clamp } from "@/lib/utils";

export function usePlaybackClock(playback: PlaybackState | null, tickMs = PLAYBACK_UI_TICK_MS) {
  const [progressMs, setProgressMs] = useState(0);

  useEffect(() => {
    if (!playback?.track) {
      setProgressMs(0);
      return;
    }

    const fetchedAt = parseFetchedAtMs(playback.fetchedAt);

    const updateProgress = () => {
      const elapsedMs = playback.isPlaying ? Date.now() - fetchedAt : 0;
      const nextProgressMs = clamp(
        playback.progressMs + elapsedMs,
        0,
        playback.track?.durationMs ?? playback.progressMs
      );

      setProgressMs(nextProgressMs);
    };

    updateProgress();

    if (!playback.isPlaying) {
      return;
    }

    // Between network polls we advance a lightweight local clock so lyric highlighting feels live instead of jumping every few seconds.
    const timer = window.setInterval(updateProgress, tickMs);

    return () => window.clearInterval(timer);
  }, [
    playback?.fetchedAt,
    playback?.isPlaying,
    playback?.progressMs,
    playback?.track?.durationMs,
    playback?.track?.spotifyTrackId,
    tickMs
  ]);

  return progressMs;
}

function parseFetchedAtMs(value: string) {
  const asDate = new Date(value).getTime();

  if (Number.isFinite(asDate)) {
    return asDate;
  }

  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : Date.now();
}
