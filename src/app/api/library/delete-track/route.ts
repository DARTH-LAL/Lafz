import { NextRequest, NextResponse } from "next/server";

import { removeAiUsageRunsForTracks } from "@/features/ai/usage-tracker";
import { deleteCloudDataJson, listCloudDataKeys } from "@/features/cloud/data-store";
import { getSupabaseServerClient } from "@/features/cloud/supabase";
import { removeTracksFromLibraryPlaylists } from "@/features/library/playlists-repository";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function deleteSupabaseTrackRows(spotifyTrackId: string) {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  await Promise.all([
    supabase.from("translation_drafts").delete().eq("spotify_track_id", spotifyTrackId),
    supabase.from("published_translations").delete().eq("spotify_track_id", spotifyTrackId)
  ]);
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

  if (await deleteCloudDataJson(`data/lyrics/cache/${spotifyTrackId}.json`)) {
    deleted.push("lyrics cache");
  }

  if (await deleteCloudDataJson(`data/translations/local/${spotifyTrackId}.json`)) {
    deleted.push("translation file");
  }

  if (await deleteCloudDataJson(`data/translations/drafts/${spotifyTrackId}.json`)) {
    deleted.push("draft file");
  }

  if (await deleteCloudDataJson(`data/translations/generation-log/${spotifyTrackId}.json`)) {
    deleted.push("generation log");
  }

  if (await deleteCloudDataJson(`data/ai/glossaries/local/tracks/${spotifyTrackId}.json`)) {
    deleted.push("track glossary");
  }

  const backupKeys = (await listCloudDataKeys("data/translations/backups"))
    .filter((key) => key.includes(`/${spotifyTrackId}.`) && key.endsWith(".json"));
  await Promise.all(backupKeys.map((key) => deleteCloudDataJson(key)));
  if (backupKeys.length > 0) {
    deleted.push(`${backupKeys.length} backup(s)`);
  }

  const playlistChanges = await removeTracksFromLibraryPlaylists([spotifyTrackId]);
  if (playlistChanges.updatedCount > 0 || playlistChanges.deletedCount > 0) {
    deleted.push("playlist entries");
  }

  const removedUsageRuns = await removeAiUsageRunsForTracks([spotifyTrackId]);
  if (removedUsageRuns > 0) {
    deleted.push("analytics records");
  }

  await deleteSupabaseTrackRows(spotifyTrackId);

  return NextResponse.json({
    success: true,
    spotifyTrackId,
    deleted,
    message: `Track removed (${deleted.join(", ") || "no cloud objects found"}).`
  });
}
