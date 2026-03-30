import { readLibraryPlaylistByKey, writeLibraryPlaylistFile, listLibraryPlaylistKeys, getLibraryPlaylistFileNameFromKey } from "@/features/library/playlists-repository";

type SpotifyTracksResponse = {
  tracks?: Array<{
    id?: string | null;
    album?: {
      images?: Array<{ url?: string; width?: number; height?: number }>;
    };
  } | null>;
};

/**
 * Fetches album art URLs from Spotify for up to 50 IDs per request.
 * Returns a map of { spotifyTrackId -> imageUrl | null }.
 */
async function fetchAlbumArtFromSpotify(
  ids: string[],
  accessToken: string
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};

  // Batch into chunks of 50 (Spotify max)
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) {
    batches.push(ids.slice(i, i + 50));
  }

  await Promise.all(
    batches.map(async (batch) => {
      try {
        const response = await fetch(
          `https://api.spotify.com/v1/tracks?ids=${batch.join(",")}&market=from_token`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            cache: "no-store"
          }
        );

        if (!response.ok) return;

        const data = (await response.json()) as SpotifyTracksResponse;

        for (const track of data.tracks ?? []) {
          if (track?.id) {
            result[track.id] = track.album?.images?.[0]?.url ?? null;
          }
        }
      } catch {
        // non-fatal
      }
    })
  );

  return result;
}

/**
 * Backfills album_art_url into any playlist objects that are missing it,
 * then returns a complete map of { spotifyTrackId -> imageUrl | null } for all tracks
 * in the provided records.
 */
export async function resolveAlbumArtForRecords(
  trackIds: string[],
  existingArtMap: Record<string, string | null>,
  accessToken: string
): Promise<Record<string, string | null>> {
  const missingIds = trackIds.filter((id) => !existingArtMap[id]);

  if (missingIds.length === 0) return existingArtMap;

  const fetched = await fetchAlbumArtFromSpotify(missingIds, accessToken);
  const merged = { ...existingArtMap, ...fetched };

  // Backfill playlist JSON files — fire-and-forget
  void backfillPlaylistFiles(fetched);

  return merged;
}

async function backfillPlaylistFiles(artMap: Record<string, string | null>) {
  try {
    const keys = await listLibraryPlaylistKeys();

    await Promise.all(
      keys.map(async (key) => {
        try {
          const data = await readLibraryPlaylistByKey(key);

          if (!data || !Array.isArray(data.tracks)) return;

          let changed = false;
          for (const track of data.tracks) {
            if (track.spotify_track_id && !track.album_art_url && artMap[track.spotify_track_id]) {
              track.album_art_url = artMap[track.spotify_track_id];
              changed = true;
            }
          }

          if (changed) {
            await writeLibraryPlaylistFile(data, getLibraryPlaylistFileNameFromKey(key));
          }
        } catch {
          // skip malformed
        }
      })
    );
  } catch {
    // ignore
  }
}
