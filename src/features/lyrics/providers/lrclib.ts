import { parseLrcText } from "@/features/lyrics/lrc";
import type { LyricsCacheFile, LyricsLookupParams } from "@/features/lyrics/types";

const LRCLIB_BASE_URL = "https://lrclib.net/api";
const LRCLIB_USER_AGENT = "Lafz/0.1.0 (https://github.com/sambhavg/lafz)";

type LrclibTrack = {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
};

// Try an exact metadata match first. lrclib uses all four fields to find a
// specific recording — the duration in particular helps disambiguate live
// versions and remixes from the studio cut.
async function exactLookup(params: LyricsLookupParams): Promise<LrclibTrack | null> {
  const url = new URL(`${LRCLIB_BASE_URL}/get`);
  url.searchParams.set("track_name", params.title);
  url.searchParams.set("artist_name", params.artist);
  url.searchParams.set("album_name", params.album);
  url.searchParams.set("duration", String(Math.round(params.durationMs / 1000)));

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": LRCLIB_USER_AGENT },
    cache: "no-store"
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`lrclib exact lookup failed with status ${response.status}`);
  }

  return (await response.json()) as LrclibTrack;
}

// Fuzzy search fallback — used when the album name or exact duration doesn't
// match any lrclib record. We pick the result whose duration is closest to the
// Spotify track duration.
async function searchLookup(params: LyricsLookupParams): Promise<LrclibTrack | null> {
  const url = new URL(`${LRCLIB_BASE_URL}/search`);
  url.searchParams.set("track_name", params.title);
  url.searchParams.set("artist_name", params.artist);

  const response = await fetch(url.toString(), {
    headers: { "User-Agent": LRCLIB_USER_AGENT },
    cache: "no-store"
  });

  if (!response.ok) {
    return null;
  }

  const results = (await response.json()) as LrclibTrack[];

  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  const durationSec = params.durationMs / 1000;

  // Prefer results that actually have lyrics, then sort by duration proximity.
  const withLyrics = results.filter((r) => r.syncedLyrics || r.plainLyrics);
  const pool = withLyrics.length > 0 ? withLyrics : results;

  return pool.sort((a, b) => Math.abs(a.duration - durationSec) - Math.abs(b.duration - durationSec))[0] ?? null;
}

function buildCacheFile(params: LyricsLookupParams, track: LrclibTrack): LyricsCacheFile | null {
  if (track.instrumental) {
    // Instrumental tracks have no lyrics — nothing to cache.
    return null;
  }

  if (track.syncedLyrics) {
    const lines = parseLrcText(track.syncedLyrics);

    if (lines.length > 0) {
      return {
        spotifyTrackId: params.spotifyTrackId,
        title: params.title,
        artist: params.artist,
        album: params.album,
        durationMs: params.durationMs,
        source: "lrclib",
        sourceLabel: "lrclib.net",
        kind: "synced",
        language: null,
        fetchedAt: new Date().toISOString(),
        providerTrackId: String(track.id),
        lines,
        plainLyrics: null
      };
    }
  }

  if (track.plainLyrics) {
    return {
      spotifyTrackId: params.spotifyTrackId,
      title: params.title,
      artist: params.artist,
      album: params.album,
      durationMs: params.durationMs,
      source: "lrclib",
      sourceLabel: "lrclib.net",
      kind: "plain",
      language: null,
      fetchedAt: new Date().toISOString(),
      providerTrackId: String(track.id),
      lines: [],
      plainLyrics: track.plainLyrics
    };
  }

  return null;
}

export async function fetchFromLrclib(params: LyricsLookupParams): Promise<LyricsCacheFile | null> {
  // 1. Try exact match using all four metadata fields.
  const exact = await exactLookup(params);

  if (exact) {
    return buildCacheFile(params, exact);
  }

  // 2. Fall back to fuzzy search by title + artist, pick closest duration.
  const searched = await searchLookup(params);

  if (searched) {
    return buildCacheFile(params, searched);
  }

  return null;
}
