import { writeLyricsCacheFile } from "@/features/lyrics/repository";
import { parseLrcText } from "@/features/lyrics/lrc";
import type { LyricsCacheFile, LyricsLookupParams, LyricsLookupResult } from "@/features/lyrics/types";

const MUSIXMATCH_API_BASE_URL = "https://api.musixmatch.com/ws/1.1";

type MusixmatchMessageBody = Record<string, unknown> | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getMusixmatchApiKey() {
  const value = process.env.MUSIXMATCH_API_KEY;
  return value && value.trim().length > 0 ? value.trim() : null;
}

function stripMusixmatchDisclaimer(text: string) {
  return text
    .replace(/\*{3,}[\s\S]*?commercial use[\s\S]*$/i, "")
    .replace(/This Lyrics is NOT for Commercial use[\s\S]*$/i, "")
    .trim();
}

async function fetchMusixmatchBody(method: string, params: Record<string, string>) {
  const apiKey = getMusixmatchApiKey();

  if (!apiKey) {
    throw new Error("MUSIXMATCH_API_KEY is not set.");
  }

  const searchParams = new URLSearchParams({
    apikey: apiKey,
    format: "json",
    ...params
  });

  const response = await fetch(`${MUSIXMATCH_API_BASE_URL}/${method}?${searchParams.toString()}`, {
    cache: "no-store"
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  const message = isRecord(payload) && isRecord(payload.message) ? payload.message : null;
  const header = message && isRecord(message.header) ? message.header : null;
  const body = message && isRecord(message.body) ? message.body : null;
  const statusCode = header ? asNumber(header.status_code) ?? response.status : response.status;

  if (statusCode >= 400) {
    const statusMessage = header ? asString(header.status_message) : null;
    throw new Error(statusMessage ?? `Musixmatch request failed with status ${statusCode}.`);
  }

  return body satisfies MusixmatchMessageBody;
}

async function findTrackOnMusixmatch(params: LyricsLookupParams) {
  const body = await fetchMusixmatchBody("matcher.track.get", {
    q_track: params.title,
    q_artist: params.artist,
    f_has_lyrics: "1"
  });

  const track = body && isRecord(body.track) ? body.track : null;

  return {
    trackId: track ? asNumber(track.track_id)?.toString() ?? null : null,
    lyricsLanguage: track ? asString(track.lyrics_language) ?? asString(track.subtitle_language) : null
  };
}

async function fetchSyncedLyrics(trackId: string) {
  try {
    const body = await fetchMusixmatchBody("track.subtitle.get", {
      track_id: trackId,
      subtitle_format: "lrc"
    });
    const subtitle = body && isRecord(body.subtitle) ? body.subtitle : null;
    const subtitleBody = subtitle ? asString(subtitle.subtitle_body) : null;

    if (!subtitleBody) {
      return null;
    }

    const cues = parseLrcText(subtitleBody);

    if (cues.length === 0) {
      return null;
    }

    return cues;
  } catch {
    return null;
  }
}

async function fetchPlainLyrics(trackId: string) {
  try {
    const body = await fetchMusixmatchBody("track.lyrics.get", {
      track_id: trackId
    });
    const lyrics = body && isRecord(body.lyrics) ? body.lyrics : null;
    const lyricsBody = lyrics ? asString(lyrics.lyrics_body) : null;

    if (!lyricsBody) {
      return null;
    }

    const cleanedLyrics = stripMusixmatchDisclaimer(lyricsBody);
    return cleanedLyrics || null;
  } catch {
    return null;
  }
}

export function isMusixmatchConfigured() {
  return Boolean(getMusixmatchApiKey());
}

export async function fetchOfficialLyrics(params: LyricsLookupParams): Promise<LyricsLookupResult> {
  if (!isMusixmatchConfigured()) {
    return {
      status: "missing_provider_config"
    };
  }

  try {
    const matchedTrack = await findTrackOnMusixmatch(params);

    if (!matchedTrack.trackId) {
      return {
        status: "not_found"
      };
    }

    const syncedLyrics = await fetchSyncedLyrics(matchedTrack.trackId);

    if (syncedLyrics) {
      const cacheFile: LyricsCacheFile = {
        spotifyTrackId: params.spotifyTrackId,
        title: params.title,
        artist: params.artist,
        album: params.album,
        durationMs: params.durationMs,
        source: "musixmatch",
        sourceLabel: "Musixmatch official provider",
        kind: "synced",
        language: matchedTrack.lyricsLanguage,
        fetchedAt: new Date().toISOString(),
        providerTrackId: matchedTrack.trackId,
        lines: syncedLyrics,
        plainLyrics: null
      };

      await writeLyricsCacheFile(cacheFile);

      return {
        status: "fetched",
        cacheFile
      };
    }

    const plainLyrics = await fetchPlainLyrics(matchedTrack.trackId);

    if (!plainLyrics) {
      return {
        status: "not_found"
      };
    }

    const cacheFile: LyricsCacheFile = {
      spotifyTrackId: params.spotifyTrackId,
      title: params.title,
      artist: params.artist,
      album: params.album,
      durationMs: params.durationMs,
      source: "musixmatch",
      sourceLabel: "Musixmatch official provider",
      kind: "plain",
      language: matchedTrack.lyricsLanguage,
      fetchedAt: new Date().toISOString(),
      providerTrackId: matchedTrack.trackId,
      lines: [],
      plainLyrics
    };

    await writeLyricsCacheFile(cacheFile);

    return {
      status: "fetched",
      cacheFile
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Official lyrics lookup failed."
    };
  }
}
