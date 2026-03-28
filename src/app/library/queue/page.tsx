import { redirect } from "next/navigation";

import { LibraryQueueView } from "@/components/library-queue-view";
import { resolveAlbumArtForRecords } from "@/features/library/album-art";
import { buildLibraryQueue, filterQueueRecords, parseLibraryQueueFilters, sortQueueRecords } from "@/features/library/queue";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";
import { ensureFreshSpotifySession } from "@/features/spotify/server-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LibraryQueuePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LibraryQueuePage({ searchParams }: LibraryQueuePageProps) {
  const rawSession = await readSpotifySessionFromCookies();

  if (!rawSession) {
    redirect("/login");
  }

  // Always ensure the token is fresh before making Spotify API calls
  const { session } = await ensureFreshSpotifySession(rawSession);

  const resolvedSearchParams = searchParams ? await searchParams : {};
  const queue = await buildLibraryQueue();
  const filters = parseLibraryQueueFilters(resolvedSearchParams);
  const records = sortQueueRecords(filterQueueRecords(queue.tracks, filters), filters.sort);

  // Build a map of already-stored art URLs, then fill in any missing ones from Spotify
  const storedArt: Record<string, string | null> = {};
  for (const r of queue.tracks) {
    if (r.album_art_url) storedArt[r.spotify_track_id] = r.album_art_url;
  }
  const artMap = await resolveAlbumArtForRecords(
    queue.tracks.map((r) => r.spotify_track_id),
    storedArt,
    session.accessToken
  );

  return <LibraryQueueView queue={queue} records={records} filters={filters} artMap={artMap} />;
}
