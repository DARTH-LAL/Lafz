import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const libraryPlaylistsRoot = path.join(process.cwd(), "data", "library", "playlists");

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
 * Backfills album_art_url into any playlist JSON files that are missing it,
 * then returns a complete map of { spotifyTrackId -> imageUrl | null }
 * for all tracks in the provided records.
 *
 * Writes updated playlist files back to disk (non-blocking — we don't await
 * the writes in the caller).
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
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir(libraryPlaylistsRoot)).filter((f) => f.endsWith(".json"));

    await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(libraryPlaylistsRoot, file);
        try {
          const raw = await readFile(filePath, "utf-8");
          const data = JSON.parse(raw) as {
            tracks?: Array<{ spotify_track_id?: string; album_art_url?: string | null }>;
          };

          if (!Array.isArray(data.tracks)) return;

          let changed = false;
          for (const track of data.tracks) {
            if (track.spotify_track_id && !track.album_art_url && artMap[track.spotify_track_id]) {
              track.album_art_url = artMap[track.spotify_track_id];
              changed = true;
            }
          }

          if (changed) {
            await writeFile(filePath, JSON.stringify(data, null, 2));
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
