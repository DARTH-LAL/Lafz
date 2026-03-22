import { SPOTIFY_API_BASE_URL } from "@/features/spotify/config";
import type { PlaybackState, SpotifyRepeatMode } from "@/features/spotify/types";

class SpotifyUnauthorizedError extends Error {
  constructor() {
    super("Spotify access token is invalid or expired.");
  }
}

export { SpotifyUnauthorizedError };

export class SpotifyPlaybackControlError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type SpotifyPlaybackApiResponse = {
  is_playing: boolean;
  shuffle_state?: boolean;
  repeat_state?: string;
  progress_ms: number | null;
  currently_playing_type?: string;
  device?: {
    name?: string | null;
  } | null;
  item?: {
    id?: string | null;
    type?: string;
    name?: string;
    duration_ms?: number;
    external_urls?: {
      spotify?: string;
    };
    artists?: Array<{
      name?: string;
    }>;
    album?: {
      name?: string;
      images?: Array<{
        url?: string;
      }>;
    };
  } | null;
};

export async function fetchCurrentSpotifyPlayback(accessToken: string): Promise<PlaybackState> {
  const response = await fetch(`${SPOTIFY_API_BASE_URL}/me/player`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  });

  if (response.status === 204) {
    return {
      status: "idle",
      isPlaying: false,
      shuffleEnabled: false,
      repeatMode: "off",
      progressMs: 0,
      fetchedAt: new Date().toISOString(),
      deviceName: null,
      playbackStateLabel: "No active playback",
      track: null
    };
  }

  if (response.status === 401) {
    throw new SpotifyUnauthorizedError();
  }

  if (!response.ok) {
    throw new Error(`Spotify playback request failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as SpotifyPlaybackApiResponse;
  const item = payload.item;

  if (!item || item.type !== "track" || !item.id || !item.name) {
    return {
      status: "idle",
      isPlaying: false,
      shuffleEnabled: Boolean(payload.shuffle_state),
      repeatMode: normalizeRepeatMode(payload.repeat_state),
      progressMs: 0,
      fetchedAt: new Date().toISOString(),
      deviceName: payload.device?.name ?? null,
      playbackStateLabel: "Unsupported playback item",
      track: null
    };
  }

  const artistNames = (item.artists ?? []).map((artist) => artist.name).filter((name): name is string => Boolean(name));

  return {
    status: payload.is_playing ? "playing" : "paused",
    isPlaying: payload.is_playing,
    shuffleEnabled: Boolean(payload.shuffle_state),
    repeatMode: normalizeRepeatMode(payload.repeat_state),
    progressMs: payload.progress_ms ?? 0,
    fetchedAt: new Date().toISOString(),
    deviceName: payload.device?.name ?? null,
    playbackStateLabel: payload.is_playing ? "Playing" : "Paused",
    track: {
      spotifyTrackId: item.id,
      title: item.name,
      artist: artistNames.join(", "),
      artistNames,
      album: item.album?.name ?? "Unknown album",
      albumArtUrl: item.album?.images?.[0]?.url ?? null,
      durationMs: item.duration_ms ?? 0,
      externalUrl: item.external_urls?.spotify ?? null
    }
  };
}

function normalizeRepeatMode(value?: string): SpotifyRepeatMode {
  if (value === "track" || value === "context") {
    return value;
  }

  return "off";
}

export type SpotifyPlaybackCommand =
  | { action: "play" }
  | { action: "pause" }
  | { action: "next" }
  | { action: "previous" }
  | { action: "seek"; positionMs: number }
  | { action: "shuffle"; enabled: boolean }
  | { action: "repeat"; mode: SpotifyRepeatMode };

export async function sendSpotifyPlaybackCommand(accessToken: string, command: SpotifyPlaybackCommand) {
  const { method, path } = buildPlaybackCommandRequest(command);
  const response = await fetch(`${SPOTIFY_API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  });

  if (response.status === 401) {
    throw new SpotifyUnauthorizedError();
  }

  if (!response.ok) {
    const fallbackMessage =
      response.status === 403
        ? "Spotify rejected the playback command. Make sure playback is active on a Premium device."
        : response.status === 404
          ? "Spotify could not find an active playback device for this command."
          : `Spotify playback control failed with status ${response.status}.`;
    throw new SpotifyPlaybackControlError(fallbackMessage, response.status);
  }
}

function buildPlaybackCommandRequest(command: SpotifyPlaybackCommand) {
  switch (command.action) {
    case "play":
      return { method: "PUT", path: "/me/player/play" };
    case "pause":
      return { method: "PUT", path: "/me/player/pause" };
    case "next":
      return { method: "POST", path: "/me/player/next" };
    case "previous":
      return { method: "POST", path: "/me/player/previous" };
    case "seek":
      return {
        method: "PUT",
        path: `/me/player/seek?${new URLSearchParams({ position_ms: String(Math.max(0, Math.floor(command.positionMs))) }).toString()}`
      };
    case "shuffle":
      return {
        method: "PUT",
        path: `/me/player/shuffle?${new URLSearchParams({ state: String(command.enabled) }).toString()}`
      };
    case "repeat":
      return {
        method: "PUT",
        path: `/me/player/repeat?${new URLSearchParams({ state: command.mode }).toString()}`
      };
  }
}
