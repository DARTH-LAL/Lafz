import { listLibraryPlaylistKeys, readLibraryPlaylistByKey } from "@/features/library/playlists-repository";

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeLooseTitle(value: string) {
  return normalizeText(
    value
      .replace(/\((?:[^()]|\([^()]*\))*\)/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\s[-–—]\s.*$/, " ")
      .replace(/\b(?:feat|ft|featuring)\b.*$/i, " ")
  );
}

function normalizeArtistTokens(value: string | null | undefined) {
  return String(value ?? "")
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/gi)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function trackMatches(
  track: { title: string; artist: string; album: string; album_art_url: string | null },
  target: { title: string; artist?: string | null; album?: string | null }
) {
  const normalizedTargetTitle = normalizeText(target.title);
  const normalizedTrackTitle = normalizeText(track.title);
  const looseTargetTitle = normalizeLooseTitle(target.title);
  const looseTrackTitle = normalizeLooseTitle(track.title);

  if (!normalizedTargetTitle || !normalizedTrackTitle) {
    return false;
  }

  const titleMatches = normalizedTargetTitle === normalizedTrackTitle || looseTargetTitle === looseTrackTitle;

  if (!titleMatches) {
    return false;
  }

  const targetArtist = normalizeText(target.artist ?? "");
  const trackArtist = normalizeText(track.artist);

  if (!targetArtist) {
    return true;
  }

  if (trackArtist === targetArtist) {
    if (!target.album) {
      return true;
    }

    const normalizedTargetAlbum = normalizeText(target.album);
    const normalizedTrackAlbum = normalizeText(track.album);

    return !normalizedTargetAlbum || !normalizedTrackAlbum || normalizedTargetAlbum === normalizedTrackAlbum;
  }

  const targetTokens = new Set(normalizeArtistTokens(target.artist));
  const overlap = normalizeArtistTokens(track.artist).filter((token) => targetTokens.has(token)).length;

  return overlap > 0;
}

export async function findLibraryTrackArtworkUrlByTrackId(trackId: string) {
  const normalizedTrackId = trackId.trim();

  if (!normalizedTrackId) {
    return null;
  }

  const keys = await listLibraryPlaylistKeys();

  for (const key of keys) {
    const playlist = await readLibraryPlaylistByKey(key).catch(() => null);

    if (!playlist || !Array.isArray(playlist.tracks)) {
      continue;
    }

    const matchingTrack = playlist.tracks.find(
      (track) => track.spotify_track_id === normalizedTrackId && Boolean(track.album_art_url)
    );

    if (matchingTrack?.album_art_url) {
      return matchingTrack.album_art_url;
    }
  }

  return null;
}

export async function findLibraryTrackArtworkUrlByMetadata(target: { title: string; artist?: string | null; album?: string | null }) {
  if (!target.title.trim()) {
    return null;
  }

  const keys = await listLibraryPlaylistKeys();

  for (const key of keys) {
    const playlist = await readLibraryPlaylistByKey(key).catch(() => null);

    if (!playlist || !Array.isArray(playlist.tracks)) {
      continue;
    }

    const matchingTrack = playlist.tracks.find((track) => {
      if (!track.album_art_url) {
        return false;
      }

      return trackMatches(track, target);
    });

    if (matchingTrack?.album_art_url) {
      return matchingTrack.album_art_url;
    }
  }

  return null;
}
