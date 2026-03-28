import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATA_ROOT = path.join(process.cwd(), "data");

function safeUnlink(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function removeTrackFromPlaylist(playlistPath: string, spotifyTrackId: string) {
  try {
    const raw = fs.readFileSync(playlistPath, "utf-8");
    const playlist = JSON.parse(raw) as { tracks?: Array<{ spotify_track_id: string }> };
    if (!Array.isArray(playlist.tracks)) return;
    const before = playlist.tracks.length;
    playlist.tracks = playlist.tracks.filter((t) => t.spotify_track_id !== spotifyTrackId);
    if (playlist.tracks.length !== before) {
      fs.writeFileSync(playlistPath, JSON.stringify(playlist, null, 2));
    }
  } catch {
    // ignore malformed playlist files
  }
}

export async function DELETE(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ success: false, error: "Spotify session expired." }, { status: 401 });
  }

  const { spotifyTrackId } = (await request.json().catch(() => ({}))) as { spotifyTrackId?: string };

  if (!spotifyTrackId || typeof spotifyTrackId !== "string" || !/^[A-Za-z0-9]{10,30}$/.test(spotifyTrackId)) {
    return NextResponse.json({ success: false, error: "Invalid track ID." }, { status: 400 });
  }

  const deleted: string[] = [];

  // 1. Lyrics cache
  if (safeUnlink(path.join(DATA_ROOT, "lyrics", "cache", `${spotifyTrackId}.json`))) {
    deleted.push("lyrics cache");
  }

  // 2. Translation file
  if (safeUnlink(path.join(DATA_ROOT, "translations", "local", `${spotifyTrackId}.json`))) {
    deleted.push("translation file");
  }

  // 3. Draft file
  if (safeUnlink(path.join(DATA_ROOT, "translations", "drafts", `${spotifyTrackId}.json`))) {
    deleted.push("draft file");
  }

  // 4. Backup files (pattern: [id].*.json)
  const backupsDir = path.join(DATA_ROOT, "translations", "backups");
  try {
    if (fs.existsSync(backupsDir)) {
      const backups = fs.readdirSync(backupsDir).filter((f) => f.startsWith(`${spotifyTrackId}.`));
      for (const backup of backups) {
        safeUnlink(path.join(backupsDir, backup));
      }
      if (backups.length > 0) deleted.push(`${backups.length} backup(s)`);
    }
  } catch {
    // ignore
  }

  // 5. Remove track from all playlist files
  const playlistsDir = path.join(DATA_ROOT, "library", "playlists");
  try {
    if (fs.existsSync(playlistsDir)) {
      const playlistFiles = fs.readdirSync(playlistsDir).filter((f) => f.endsWith(".json"));
      for (const file of playlistFiles) {
        removeTrackFromPlaylist(path.join(playlistsDir, file), spotifyTrackId);
      }
      if (playlistFiles.length > 0) deleted.push("playlist entries");
    }
  } catch {
    // ignore
  }

  // 6. Remove from usage-runs.json
  const usageFile = path.join(DATA_ROOT, "ai", "usage-runs.json");
  try {
    if (fs.existsSync(usageFile)) {
      const runs = JSON.parse(fs.readFileSync(usageFile, "utf-8")) as Array<{ spotifyTrackId: string }>;
      const filtered = runs.filter((r) => r.spotifyTrackId !== spotifyTrackId);
      if (filtered.length !== runs.length) {
        fs.writeFileSync(usageFile, JSON.stringify(filtered, null, 2));
        deleted.push("analytics records");
      }
    }
  } catch {
    // ignore
  }

  return NextResponse.json({
    success: true,
    spotifyTrackId,
    deleted,
    message: `Track removed (${deleted.join(", ") || "no files found"}).`
  });
}
