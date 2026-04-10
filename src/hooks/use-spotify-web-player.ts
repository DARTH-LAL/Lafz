"use client";

import { useEffect, useRef, useState } from "react";

export type WebPlayerState = {
  deviceId: string | null;
  isReady: boolean;
  isPlaying: boolean;
  trackName: string | null;
  artistName: string | null;
  albumArtUrl: string | null;
  progressMs: number;
  durationMs: number;
  volume: number;
};

const INITIAL_STATE: WebPlayerState = {
  deviceId: null,
  isReady: false,
  isPlaying: false,
  trackName: null,
  artistName: null,
  albumArtUrl: null,
  progressMs: 0,
  durationMs: 0,
  volume: 0.8,
};

declare global {
  interface Window {
    Spotify: {
      Player: new (options: {
        name: string;
        getOAuthToken: (cb: (token: string) => void) => void;
        volume: number;
      }) => SpotifyPlayer;
    };
    onSpotifyWebPlaybackSDKReady: () => void;
  }
}

type SpotifyPlayer = {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  addListener: (event: string, cb: (data: unknown) => void) => void;
  removeListener: (event: string, cb?: (data: unknown) => void) => void;
  togglePlay: () => Promise<void>;
  nextTrack: () => Promise<void>;
  previousTrack: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  getCurrentState: () => Promise<SpotifyPlayerState | null>;
};

type SpotifyPlayerState = {
  paused: boolean;
  position: number;
  duration: number;
  track_window: {
    current_track: {
      name: string;
      artists: Array<{ name: string }>;
      album: { images: Array<{ url: string }> };
    };
  };
};

async function fetchToken(): Promise<string> {
  const res = await fetch("/api/spotify/token");
  const data = await res.json() as { accessToken?: string };
  return data.accessToken ?? "";
}

function loadSDKScript(): Promise<void> {
  return new Promise((resolve) => {
    if (document.getElementById("spotify-web-playback-sdk")) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.id = "spotify-web-playback-sdk";
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    document.body.appendChild(script);
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
  });
}

export function useSpotifyWebPlayer() {
  const [state, setState] = useState<WebPlayerState>(INITIAL_STATE);
  const playerRef = useRef<SpotifyPlayer | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await loadSDKScript();
      if (cancelled) return;

      const player = new window.Spotify.Player({
        name: "Lafz Desktop",
        getOAuthToken: (cb) => { void fetchToken().then(cb); },
        volume: 0.8,
      });

      playerRef.current = player;

      player.addListener("ready", (data) => {
        const { device_id } = data as { device_id: string };
        setState((s) => ({ ...s, deviceId: device_id, isReady: true }));
        console.log("[lafz] Web Player ready, device:", device_id);
      });

      player.addListener("not_ready", () => {
        setState((s) => ({ ...s, isReady: false }));
      });

      player.addListener("player_state_changed", (data) => {
        const ps = data as SpotifyPlayerState | null;
        if (!ps) return;
        const track = ps.track_window.current_track;
        setState((s) => ({
          ...s,
          isPlaying: !ps.paused,
          progressMs: ps.position,
          durationMs: ps.duration,
          trackName: track.name,
          artistName: track.artists.map((a) => a.name).join(", "),
          albumArtUrl: track.album.images[0]?.url ?? null,
        }));
      });

      player.addListener("initialization_error", (e) => console.error("[lafz] init error", e));
      player.addListener("authentication_error", (e) => console.error("[lafz] auth error", e));
      player.addListener("account_error", (e) => console.error("[lafz] account error", e));

      await player.connect();
    })();

    return () => {
      cancelled = true;
      playerRef.current?.disconnect();
    };
  }, []);

  const controls = {
    togglePlay: () => playerRef.current?.togglePlay(),
    next: () => playerRef.current?.nextTrack(),
    previous: () => playerRef.current?.previousTrack(),
    seek: (ms: number) => playerRef.current?.seek(ms),
    setVolume: (v: number) => {
      void playerRef.current?.setVolume(v);
      setState((s) => ({ ...s, volume: v }));
    },
  };

  return { state, controls };
}
