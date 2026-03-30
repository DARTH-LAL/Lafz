import { writeLibraryPlaylistFile as writeCloudLibraryPlaylistFile } from "@/features/library/playlists-repository";
import { createTranslationStubsForTracks } from "@/features/translations/stubs";
import type {
  LafzLibraryPlaylistFile,
  LafzLibraryTrack,
  PlaylistImportOptions,
  PlaylistImportErrorResponse,
  PlaylistImportResult,
  PlaylistImportSkippedReason,
  TranslationStatus
} from "@/features/spotify/types";

const skipReasonOrder = [
  "duplicate_track",
  "local_track",
  "unavailable_track",
  "unsupported_item"
] as const satisfies readonly PlaylistImportSkippedReason[];

class PlaylistImportInputError extends Error {}
class SpotifyApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type SpotifyPlaylistMetadataResponse = {
  id?: string;
  name?: string;
  external_urls?: {
    spotify?: string;
  };
  owner?: {
    display_name?: string | null;
  };
  tracks?: {
    total?: number;
  };
};

type SpotifyPlaylistTrackItem = {
  is_local?: boolean;
  item?: {
    id?: string | null;
    type?: string;
    name?: string;
    duration_ms?: number;
    is_playable?: boolean | null;
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
  } | null;
  track?: {
    id?: string | null;
    type?: string;
    name?: string;
    duration_ms?: number;
    is_playable?: boolean | null;
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
  } | null;
};

type SpotifyPlaylistTracksPageResponse = {
  items?: SpotifyPlaylistTrackItem[];
  limit?: number;
  next?: string | null;
  offset?: number;
  total?: number;
};

function createSkippedReasonCounts() {
  return {
    duplicate_track: 0,
    local_track: 0,
    unavailable_track: 0,
    unsupported_item: 0
  } satisfies Record<PlaylistImportSkippedReason, number>;
}

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown playlist import error.";
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
    throw new SpotifyApiError(
      spotifyMessage ??
          "Spotify denied this playlist request.",
        response.status
      );
    }

    if (response.status === 404) {
      throw new SpotifyApiError(spotifyMessage ?? "Spotify could not find that playlist.", response.status);
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

export function extractSpotifyPlaylistId(input: string) {
  const trimmedInput = input.trim();

  if (!trimmedInput) {
    throw new PlaylistImportInputError("Enter a Spotify playlist URL or playlist ID.");
  }

  const directIdPattern = /^[A-Za-z0-9]{22}$/;

  if (directIdPattern.test(trimmedInput)) {
    return trimmedInput;
  }

  const spotifyUriPattern = /^spotify:playlist:([A-Za-z0-9]{22})$/;
  const uriMatch = trimmedInput.match(spotifyUriPattern);

  if (uriMatch) {
    return uriMatch[1];
  }

  try {
    const parsedUrl = new URL(trimmedInput);
    const match = parsedUrl.pathname.match(/^\/playlist\/([A-Za-z0-9]{22})\/?$/);

    if (
      (parsedUrl.hostname === "open.spotify.com" || parsedUrl.hostname === "play.spotify.com") &&
      match
    ) {
      return match[1];
    }
  } catch {
    // Fall through to the validation error below for non-URL input.
  }

  throw new PlaylistImportInputError("Lafz could not extract a Spotify playlist ID from that input.");
}

function normalizePlaylistTrack(
  item: SpotifyPlaylistTrackItem,
  sourcePlaylistId: string,
  sourcePlaylistName: string,
  seenTrackIds: Set<string>
): { track: LafzLibraryTrack | null; skippedReason: PlaylistImportSkippedReason | null } {
  if (item.is_local) {
    return {
      track: null,
      skippedReason: "local_track"
    };
  }

  const track = item.item ?? item.track;

  if (!track || track.type !== "track") {
    return {
      track: null,
      skippedReason: "unsupported_item"
    };
  }

  if (!track.id || track.is_playable === false) {
    return {
      track: null,
      skippedReason: "unavailable_track"
    };
  }

  if (seenTrackIds.has(track.id)) {
    return {
      track: null,
      skippedReason: "duplicate_track"
    };
  }

  seenTrackIds.add(track.id);

  const artistNames = (track.artists ?? [])
    .map((artist) => artist.name)
    .filter((name): name is string => Boolean(name));

  // Pick the largest image (Spotify sorts images descending by size)
  const albumArtUrl = track.album?.images?.[0]?.url ?? null;

  return {
    track: {
      spotify_track_id: track.id,
      title: track.name ?? "Unknown track",
      artist: artistNames.join(", ") || "Unknown artist",
      album: track.album?.name ?? "Unknown album",
      album_art_url: albumArtUrl,
      duration_ms: track.duration_ms ?? 0,
      source_playlist_id: sourcePlaylistId,
      source_playlist_name: sourcePlaylistName,
      language: "unknown",
      translation_status: "pending" as TranslationStatus,
      spotify_track_url: track.external_urls?.spotify ?? null
    },
    skippedReason: null
  };
}

async function fetchSpotifyPlaylistMetadata(accessToken: string, playlistId: string) {
  return fetchSpotifyJson<SpotifyPlaylistMetadataResponse>(
    `https://api.spotify.com/v1/playlists/${playlistId}?fields=id,name,external_urls.spotify,owner.display_name,tracks.total`,
    accessToken
  );
}

async function fetchSpotifyPlaylistTracks(accessToken: string, playlistId: string, playlistName: string) {
  let offset = 0;
  let totalTracksFetched = 0;
  const seenTrackIds = new Set<string>();
  const importedTracks: LafzLibraryTrack[] = [];
  const skippedReasons = createSkippedReasonCounts();

  // Spotify playlist items are paginated, so we walk each page until `next` is null.
  while (true) {
    const searchParams = new URLSearchParams({
      limit: "50",
      offset: offset.toString(),
      fields:
        "items(is_local,item(id,type,name,duration_ms,is_playable,external_urls.spotify,artists(name),album(name,images)),track(id,type,name,duration_ms,is_playable,external_urls.spotify,artists(name),album(name,images))),limit,next,offset,total"
    });

    let page: SpotifyPlaylistTracksPageResponse;

    try {
      page = await fetchSpotifyJson<SpotifyPlaylistTracksPageResponse>(
        `https://api.spotify.com/v1/playlists/${playlistId}/items?${searchParams.toString()}`,
        accessToken
      );
    } catch (error) {
      if (error instanceof SpotifyApiError && error.status === 403) {
        throw new SpotifyApiError(
          `Spotify blocked access to the tracks in "${playlistName}". As of February 11, 2026, new Spotify Development Mode apps can only read playlist items for playlists you own or collaborate on. Public playlists from other accounts may still return 403. Copy the playlist into one of your own playlists, or import a playlist you own or collaborate on.`,
          403
        );
      }

      throw error;
    }

    const items = page.items ?? [];

    for (const item of items) {
      totalTracksFetched += 1;

      const normalized = normalizePlaylistTrack(item, playlistId, playlistName, seenTrackIds);

      if (!normalized.track || normalized.skippedReason) {
        if (normalized.skippedReason) {
          skippedReasons[normalized.skippedReason] += 1;
        }

        continue;
      }

      importedTracks.push(normalized.track);
    }

    if (!page.next) {
      break;
    }

    offset += page.limit ?? items.length;
  }

  return {
    importedTracks,
    skippedReasons,
    totalTracksFetched
  };
}

export function getPlaylistLibraryFilePath(playlistId: string) {
  return `r2:data/library/playlists/${playlistId}.json`;
}

async function writePlaylistLibraryFile(libraryFile: LafzLibraryPlaylistFile) {
  return writeCloudLibraryPlaylistFile(libraryFile);
}

export async function importSpotifyPlaylistLibrary(
  accessToken: string,
  options: PlaylistImportOptions
): Promise<PlaylistImportResult> {
  const playlistId = extractSpotifyPlaylistId(options.playlistInput);
  const playlistMetadata = await fetchSpotifyPlaylistMetadata(accessToken, playlistId);

  if (!playlistMetadata.id || !playlistMetadata.name) {
    throw new SpotifyApiError("Spotify returned incomplete playlist metadata.", 500);
  }

  const trackResult = await fetchSpotifyPlaylistTracks(accessToken, playlistMetadata.id, playlistMetadata.name);

  const libraryFile: LafzLibraryPlaylistFile = {
    source: "spotify",
    playlist_id: playlistMetadata.id,
    playlist_name: playlistMetadata.name,
    playlist_url: playlistMetadata.external_urls?.spotify ?? null,
    owner_display_name: playlistMetadata.owner?.display_name ?? null,
    imported_at: new Date().toISOString(),
    total_tracks_fetched: trackResult.totalTracksFetched,
    imported_track_count: trackResult.importedTracks.length,
    skipped_track_count: skipReasonOrder.reduce((sum, reason) => sum + trackResult.skippedReasons[reason], 0),
    tracks: trackResult.importedTracks
  };

  const playlistFilePath = await writePlaylistLibraryFile(libraryFile);

  const translationFileResult = await createTranslationStubsForTracks(trackResult.importedTracks, {
    overwriteExistingStubs: false
  });

  return {
    playlistId: libraryFile.playlist_id,
    playlistName: libraryFile.playlist_name,
    totalTracksFetched: libraryFile.total_tracks_fetched,
    importedCount: libraryFile.imported_track_count,
    skippedCount: libraryFile.skipped_track_count,
    translationFilesCreatedCount: translationFileResult.createdCount,
    translationFilesPreservedCount: translationFileResult.skippedCount,
    playlistFilePath,
    skippedReasons: trackResult.skippedReasons
  };
}

export function toPlaylistImportErrorResponse(error: unknown): PlaylistImportErrorResponse {
  if (error instanceof PlaylistImportInputError) {
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
