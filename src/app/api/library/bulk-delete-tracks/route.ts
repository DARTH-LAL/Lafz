import { NextRequest, NextResponse } from "next/server";

import { removeAiUsageRunsForTracks } from "@/features/ai/usage-tracker";
import { deleteCloudDataJson, listCloudDataKeys } from "@/features/cloud/data-store";
import { getSupabaseServerClient } from "@/features/cloud/supabase";
import { removeTracksFromLibraryPlaylists } from "@/features/library/playlists-repository";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function deleteSupabaseTrackRows(spotifyTrackIds: string[]) {
  const supabase = getSupabaseServerClient();
  if (!supabase || spotifyTrackIds.length === 0) return;

  await Promise.all([
    supabase.from("translation_drafts").delete().in("spotify_track_id", spotifyTrackIds),
    supabase.from("published_translations").delete().in("spotify_track_id", spotifyTrackIds)
  ]);
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

  await Promise.all(
    validIds.flatMap((spotifyTrackId) => [
      deleteCloudDataJson(`data/lyrics/cache/${spotifyTrackId}.json`),
      deleteCloudDataJson(`data/translations/local/${spotifyTrackId}.json`),
      deleteCloudDataJson(`data/translations/drafts/${spotifyTrackId}.json`),
      deleteCloudDataJson(`data/translations/generation-log/${spotifyTrackId}.json`),
      deleteCloudDataJson(`data/ai/glossaries/local/tracks/${spotifyTrackId}.json`)
    ])
  );

  const backupKeys = await listCloudDataKeys("data/translations/backups");
  const idSet = new Set(validIds);
  const matchingBackups = backupKeys.filter((key) => {
    const fileName = key.split("/").pop() ?? "";
    return fileName.endsWith(".json") && [...idSet].some((id) => fileName.startsWith(`${id}.`));
  });
  await Promise.all(matchingBackups.map((key) => deleteCloudDataJson(key)));

  await removeTracksFromLibraryPlaylists(validIds);
  await removeAiUsageRunsForTracks(validIds);
  await deleteSupabaseTrackRows(validIds);

  return NextResponse.json({
    success: true,
    deleted: validIds.length,
    message: `${validIds.length} track(s) deleted from cloud storage.`
  });
}
