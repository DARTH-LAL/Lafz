import { readCloudDataJson, writeCloudDataJson, listCloudDataKeys, deleteCloudDataJson, extractCloudFileName, toCloudDataHint } from "@/features/cloud/data-store";
import type { LafzLibraryPlaylistFile } from "@/features/spotify/types";

const LIBRARY_PLAYLISTS_DIR = "data/library/playlists";

export function getPlaylistLibraryStoragePath(playlistId: string) {
  return `${LIBRARY_PLAYLISTS_DIR}/${playlistId}.json`;
}

export function getSingleTrackLibraryStoragePath(trackId: string) {
  return `${LIBRARY_PLAYLISTS_DIR}/single-track-${trackId}.json`;
}

export function getPlaylistLibraryHint(playlistId: string) {
  return toCloudDataHint(getPlaylistLibraryStoragePath(playlistId));
}

export function getSingleTrackLibraryHint(trackId: string) {
  return toCloudDataHint(getSingleTrackLibraryStoragePath(trackId));
}

export async function listLibraryPlaylistKeys() {
  return (await listCloudDataKeys(LIBRARY_PLAYLISTS_DIR))
    .filter((key) => key.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base", numeric: true }));
}

export async function readLibraryPlaylistByKey(key: string) {
  return readCloudDataJson<LafzLibraryPlaylistFile>(key);
}

export async function writeLibraryPlaylistFile(libraryFile: LafzLibraryPlaylistFile, fileName?: string) {
  const storagePath = fileName ? `${LIBRARY_PLAYLISTS_DIR}/${fileName}` : getPlaylistLibraryStoragePath(libraryFile.playlist_id);
  await writeCloudDataJson(storagePath, libraryFile);
  return toCloudDataHint(storagePath);
}

export async function removeTracksFromLibraryPlaylists(trackIds: Iterable<string>) {
  const idSet = new Set(trackIds);
  if (idSet.size === 0) {
    return { updatedCount: 0, deletedCount: 0 };
  }

  const keys = await listLibraryPlaylistKeys();
  let updatedCount = 0;
  let deletedCount = 0;

  for (const key of keys) {
    const playlist = await readLibraryPlaylistByKey(key);
    if (!playlist || !Array.isArray(playlist.tracks)) {
      continue;
    }

    const nextTracks = playlist.tracks.filter((track) => !idSet.has(track.spotify_track_id));
    if (nextTracks.length === playlist.tracks.length) {
      continue;
    }

    if (nextTracks.length === 0) {
      await deleteCloudDataJson(key);
      deletedCount += 1;
      continue;
    }

    await writeCloudDataJson(key, {
      ...playlist,
      imported_track_count: nextTracks.length,
      tracks: nextTracks
    });
    updatedCount += 1;
  }

  return { updatedCount, deletedCount };
}

export function getLibraryPlaylistFileNameFromKey(key: string) {
  return extractCloudFileName(key);
}
