import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createTranslationStubFile } from "@/features/translations/stubs";
import type {
  LafzLibraryPlaylistFile,
  LafzLibraryTrack,
  TrackImportErrorResponse,
  TrackImportOptions,
  TrackImportResult,
  TranslationStatus
} from "@/features/spotify/types";

const libraryPlaylistsRoot = path.join(process.cwd(), "data", "library", "playlists");
const singleTrackCollectionLabel = "Single song import";

class TrackImportInputError extends Error {}
class SpotifyApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type SpotifyTrackResponse = {
  id?: string | null;
  type?: string;
  is_playable?: boolean | null;
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
    images?: Array<{ url?: string; width?: number; height?: number }>;
  };
};

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown song import error.";
}

function isSpotifyErrorPayload(value: unknown): value is { error?: { message?: string; status?: number } } {
  return typeof value === "object" && value !== null && "error" in value;
}

async function fetchSpotifyJson<T>(url: string, accessToken: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  });

  const payload = (await response.json().catch(() => null)) as
    | T
    | { error?: { message?: string; status?: number } }
    | null;

  if (!response.ok) {
    const spotifyMessage = isSpotifyErrorPayload(payload) ? payload.error?.message : null;

    if (response.status === 401) {
      throw new SpotifyApiError(spotifyMessage ?? "Spotify access token is invalid or expired.", response.status);
    }

    if (response.status === 403) {
      throw new SpotifyApiError(spotifyMessage ?? "Spotify denied this track request.", response.status);
    }

    if (response.status === 404) {
      throw new SpotifyApiError(spotifyMessage ?? "Spotify could not find that track.", response.status);
    }

    if (response.status === 429) {
      throw new SpotifyApiError(
        spotifyMessage ?? "Spotify rate-limited the request. Wait a moment and try the import again.",
        response.status
      );
    }

    throw new SpotifyApiError(
      spotifyMessage ?? `Spotify request failed with status ${response.status}.`,
      response.status
    );
  }

  if (!payload) {
    throw new SpotifyApiError("Spotify returned an empty response.", 500);
  }

  return payload as T;
}

export function extractSpotifyTrackId(input: string) {
  const trimmedInput = input.trim();

  if (!trimmedInput) {
    throw new TrackImportInputError("Enter a Spotify track URL or track ID.");
  }

  const directIdPattern = /^[A-Za-z0-9]{22}$/;

  if (directIdPattern.test(trimmedInput)) {
    return trimmedInput;
  }

  const spotifyUriPattern = /^spotify:track:([A-Za-z0-9]{22})$/;
  const uriMatch = trimmedInput.match(spotifyUriPattern);

  if (uriMatch) {
    return uriMatch[1];
  }

  try {
    const parsedUrl = new URL(trimmedInput);
    const match = parsedUrl.pathname.match(/^\/track\/([A-Za-z0-9]{22})\/?$/);

    if (
      (parsedUrl.hostname === "open.spotify.com" || parsedUrl.hostname === "play.spotify.com") &&
      match
    ) {
      return match[1];
    }
  } catch {
    // Fall through to the validation error below for non-URL input.
  }

  throw new TrackImportInputError("Lafz could not extract a Spotify track ID from that input.");
}

async function fetchSpotifyTrack(accessToken: string, trackId: string) {
  return fetchSpotifyJson<SpotifyTrackResponse>(`https://api.spotify.com/v1/tracks/${trackId}`, accessToken);
}

function normalizeSpotifyTrack(track: SpotifyTrackResponse, syntheticLibraryId: string): LafzLibraryTrack {
  if (!track.id || track.type !== "track") {
    throw new SpotifyApiError("Spotify returned incomplete track metadata.", 500);
  }

  if (track.is_playable === false) {
    throw new SpotifyApiError("Spotify marked this track as unavailable for playback.", 409);
  }

  const artistNames = (track.artists ?? [])
    .map((artist) => artist.name)
    .filter((name): name is string => Boolean(name));

  return {
    spotify_track_id: track.id,
    title: track.name ?? "Unknown track",
    artist: artistNames.join(", ") || "Unknown artist",
    album: track.album?.name ?? "Unknown album",
    album_art_url: track.album?.images?.[0]?.url ?? null,
    duration_ms: track.duration_ms ?? 0,
    source_playlist_id: syntheticLibraryId,
    source_playlist_name: singleTrackCollectionLabel,
    language: "unknown",
    translation_status: "pending" as TranslationStatus,
    spotify_track_url: track.external_urls?.spotify ?? null
  };
}

export function getSingleTrackLibraryFilePath(trackId: string) {
  return path.join(libraryPlaylistsRoot, `single-track-${trackId}.json`);
}

async function writeSingleTrackLibraryFile(libraryFile: LafzLibraryPlaylistFile) {
  await mkdir(libraryPlaylistsRoot, { recursive: true });

  const filePath = getSingleTrackLibraryFilePath(libraryFile.tracks[0]?.spotify_track_id ?? libraryFile.playlist_id);
  await writeFile(filePath, `${JSON.stringify(libraryFile, null, 2)}\n`, "utf8");

  return filePath;
}

export async function importSpotifyTrackLibrary(
  accessToken: string,
  options: TrackImportOptions
): Promise<TrackImportResult> {
  const trackId = extractSpotifyTrackId(options.trackInput);
  const syntheticLibraryId = `single-track-${trackId}`;
  const spotifyTrack = await fetchSpotifyTrack(accessToken, trackId);
  const normalizedTrack = normalizeSpotifyTrack(spotifyTrack, syntheticLibraryId);

  const libraryFile: LafzLibraryPlaylistFile = {
    source: "spotify",
    playlist_id: syntheticLibraryId,
    playlist_name: singleTrackCollectionLabel,
    playlist_url: normalizedTrack.spotify_track_url,
    owner_display_name: null,
    imported_at: new Date().toISOString(),
    total_tracks_fetched: 1,
    imported_track_count: 1,
    skipped_track_count: 0,
    tracks: [normalizedTrack]
  };

  const libraryFilePath = await writeSingleTrackLibraryFile(libraryFile);

  const translationFileResult = await createTranslationStubFile({
    spotifyTrackId: normalizedTrack.spotify_track_id,
    language: normalizedTrack.language,
    overwriteExistingStub: false
  });

  return {
    syntheticLibraryId,
    trackId: normalizedTrack.spotify_track_id,
    trackTitle: normalizedTrack.title,
    trackArtist: normalizedTrack.artist,
    trackAlbum: normalizedTrack.album,
    trackDurationMs: normalizedTrack.duration_ms,
    trackUrl: normalizedTrack.spotify_track_url,
    libraryFilePath,
    translationFileStatus: translationFileResult.created ? "created" : "preserved",
    translationFilePath: translationFileResult.filePath
  };
}

export function toTrackImportErrorResponse(error: unknown): TrackImportErrorResponse {
  if (error instanceof TrackImportInputError) {
    return {
      success: false,
      status: 400,
      error: error.message
    };
  }

  if (error instanceof SpotifyApiError) {
    return {
      success: false,
      status: error.status,
      error: error.message
    };
  }

  return {
    success: false,
    status: 500,
    error: asErrorMessage(error)
  };
}
