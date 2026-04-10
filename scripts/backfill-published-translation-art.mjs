import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const playlistRoot = path.join(root, "data", "library", "playlists");

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeText(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeLooseTitle(value) {
  return normalizeText(
    value
      .replace(/\((?:[^()]|\([^()]*\))*\)/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\s[-–—]\s.*$/, " ")
      .replace(/\b(?:feat|ft|featuring)\b.*$/i, " ")
  );
}

function normalizeArtistTokens(value) {
  return value
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/gi)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function trackMatches(track, target) {
  if (!target?.title || !target?.artist) {
    return false;
  }

  const normalizedTargetTitle = normalizeText(target.title);
  const normalizedTrackTitle = normalizeText(track.title ?? "");
  const looseTargetTitle = normalizeLooseTitle(target.title);
  const looseTrackTitle = normalizeLooseTitle(track.title ?? "");

  if (!normalizedTargetTitle || !normalizedTrackTitle) {
    return false;
  }

  const titleMatches = normalizedTargetTitle === normalizedTrackTitle || looseTargetTitle === looseTrackTitle;

  if (!titleMatches) {
    return false;
  }

  const targetArtist = normalizeText(target.artist);
  const trackArtist = normalizeText(track.artist ?? "");

  if (trackArtist === targetArtist) {
    if (!target.album) {
      return true;
    }

    const normalizedTargetAlbum = normalizeText(target.album);
    const normalizedTrackAlbum = normalizeText(track.album ?? "");

    return !normalizedTargetAlbum || !normalizedTrackAlbum || normalizedTargetAlbum === normalizedTrackAlbum;
  }

  const targetTokens = new Set(normalizeArtistTokens(target.artist));
  const overlap = normalizeArtistTokens(track.artist ?? "").filter((token) => targetTokens.has(token)).length;

  return overlap > 0;
}

async function listJsonFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => path.join(dir, entry.name));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function buildTrackArtMap() {
  const files = await listJsonFiles(playlistRoot);
  const artByTrackId = new Map();
  const artRows = [];

  for (const filePath of files) {
    try {
      const parsed = await readJsonFile(filePath);

      if (!isRecord(parsed) || !Array.isArray(parsed.tracks)) {
        continue;
      }

      for (const rawTrack of parsed.tracks) {
        if (!isRecord(rawTrack)) {
          continue;
        }

        const spotifyTrackId = asString(rawTrack.spotify_track_id);
        const albumArtUrl = asString(rawTrack.album_art_url);

        if (!spotifyTrackId || !albumArtUrl) {
          continue;
        }

        const row = {
          spotify_track_id: spotifyTrackId,
          album_art_url: albumArtUrl,
          title: asString(rawTrack.title) ?? "",
          artist: asString(rawTrack.artist) ?? "",
          album: asString(rawTrack.album) ?? "",
          source_playlist_id: asString(rawTrack.source_playlist_id),
          source_playlist_name: asString(rawTrack.source_playlist_name),
          updated_at: new Date().toISOString()
        };

        artByTrackId.set(spotifyTrackId, row);
        artRows.push(row);
      }
    } catch (error) {
      console.error(`Playlist art parse failed: ${filePath}`, error instanceof Error ? error.message : String(error));
    }
  }

  return { artRows: [...artByTrackId.values()], allArtRows: artRows };
}

async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const { artRows, allArtRows } = await buildTrackArtMap();
  const artByTrackId = new Map(artRows.map((row) => [row.spotify_track_id, row.album_art_url]));
  const { data, error } = await supabase.from("published_translations").select("spotify_track_id, translation_json");

  if (error) {
    throw error;
  }

  let successCount = 0;
  let skippedCount = 0;

  for (const row of data ?? []) {
    const spotifyTrackId = asString(row.spotify_track_id);
    const translated = isRecord(row.translation_json) ? row.translation_json : {};
    const translatedTarget = {
      title: asString(translated.title),
      artist: asString(translated.artist),
      album: asString(translated.album)
    };

    let albumArtUrl = spotifyTrackId ? artByTrackId.get(spotifyTrackId) ?? null : null;

    if (!albumArtUrl && translatedTarget.title && translatedTarget.artist) {
      const metadataMatch = allArtRows.find((track) => trackMatches(track, translatedTarget));
      albumArtUrl = metadataMatch?.album_art_url ?? null;
    }

    if (!spotifyTrackId || !albumArtUrl) {
      skippedCount += 1;
      continue;
    }

    const { error: updateError } = await supabase
      .from("published_translations")
      .update({
        album_art_url: albumArtUrl,
        updated_at: new Date().toISOString()
      })
      .eq("spotify_track_id", spotifyTrackId);

    if (updateError) {
      console.error(`Album art update failed: ${spotifyTrackId}`, updateError.message);
      skippedCount += 1;
      continue;
    }

    successCount += 1;
  }

  console.log(`Backfilled album art for ${successCount} published translation row(s); skipped ${skippedCount}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
