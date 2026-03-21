"use client";

import { useEffect, useState } from "react";

import { PLAYBACK_UI_TICK_MS } from "@/features/spotify/config";
import type { PlaybackState } from "@/features/spotify/types";
import { clamp } from "@/lib/utils";

export function usePlaybackClock(playback: PlaybackState | null) {
  const [progressMs, setProgressMs] = useState(0);

  useEffect(() => {
    if (!playback?.track) {
      setProgressMs(0);
      return;
    }

    const fetchedAt = new Date(playback.fetchedAt).getTime();

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

    // Between network polls we advance a lightweight local clock so lyric highlighting feels live instead of jumping every few seconds.
    const timer = window.setInterval(updateProgress, PLAYBACK_UI_TICK_MS);

    return () => window.clearInterval(timer);
  }, [
    playback?.fetchedAt,
    playback?.isPlaying,
    playback?.progressMs,
    playback?.track?.durationMs,
    playback?.track?.spotifyTrackId
  ]);

  return progressMs;
}
