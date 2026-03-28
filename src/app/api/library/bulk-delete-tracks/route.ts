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
  } catch { /* ignore */ }
  return false;
}

function deleteTrackFiles(spotifyTrackId: string) {
  safeUnlink(path.join(DATA_ROOT, "lyrics", "cache", `${spotifyTrackId}.json`));
  safeUnlink(path.join(DATA_ROOT, "translations", "local", `${spotifyTrackId}.json`));
  safeUnlink(path.join(DATA_ROOT, "translations", "drafts", `${spotifyTrackId}.json`));

  const backupsDir = path.join(DATA_ROOT, "translations", "backups");
  if (fs.existsSync(backupsDir)) {
    fs.readdirSync(backupsDir)
      .filter((f) => f.startsWith(`${spotifyTrackId}.`))
      .forEach((f) => safeUnlink(path.join(backupsDir, f)));
  }
}

export async function DELETE(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ success: false, error: "Spotify session expired." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { spotifyTrackIds?: unknown };
  const ids = body.spotifyTrackIds;

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ success: false, error: "No track IDs provided." }, { status: 400 });
  }

  const validIds = ids.filter(
    (id): id is string => typeof id === "string" && /^[A-Za-z0-9]{10,30}$/.test(id)
  );

  // 1. Delete per-track files for all IDs
  for (const id of validIds) {
    deleteTrackFiles(id);
  }

  // 2. Update all playlist files in one pass — remove all matching IDs at once
  const idSet = new Set(validIds);
  const playlistsDir = path.join(DATA_ROOT, "library", "playlists");
  if (fs.existsSync(playlistsDir)) {
    for (const file of fs.readdirSync(playlistsDir).filter((f) => f.endsWith(".json"))) {
      try {
        const filePath = path.join(playlistsDir, file);
        const playlist = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
          tracks?: Array<{ spotify_track_id: string }>;
        };
        if (!Array.isArray(playlist.tracks)) continue;
        const before = playlist.tracks.length;
        playlist.tracks = playlist.tracks.filter((t) => !idSet.has(t.spotify_track_id));
        if (playlist.tracks.length !== before) {
          fs.writeFileSync(filePath, JSON.stringify(playlist, null, 2));
        }
      } catch { /* skip malformed */ }
    }
  }

  // 3. Remove from usage-runs.json
  const usageFile = path.join(DATA_ROOT, "ai", "usage-runs.json");
  try {
    if (fs.existsSync(usageFile)) {
      const runs = JSON.parse(fs.readFileSync(usageFile, "utf-8")) as Array<{ spotifyTrackId: string }>;
      const filtered = runs.filter((r) => !idSet.has(r.spotifyTrackId));
      if (filtered.length !== runs.length) {
        fs.writeFileSync(usageFile, JSON.stringify(filtered, null, 2));
      }
    }
  } catch { /* ignore */ }

  return NextResponse.json({
    success: true,
    deleted: validIds.length,
    message: `${validIds.length} track(s) deleted.`
  });
}
