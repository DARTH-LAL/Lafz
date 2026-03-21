import { SPOTIFY_API_BASE_URL } from "@/features/spotify/config";
import type { PlaybackState } from "@/features/spotify/types";

class SpotifyUnauthorizedError extends Error {
  constructor() {
    super("Spotify access token is invalid or expired.");
  }
}

export { SpotifyUnauthorizedError };

type SpotifyPlaybackApiResponse = {
  is_playing: boolean;
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
