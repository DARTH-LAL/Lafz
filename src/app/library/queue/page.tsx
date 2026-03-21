import { redirect } from "next/navigation";

import { LibraryQueueView } from "@/components/library-queue-view";
import { buildLibraryQueue, filterQueueRecords, parseLibraryQueueFilters, sortQueueRecords } from "@/features/library/queue";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LibraryQueuePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LibraryQueuePage({ searchParams }: LibraryQueuePageProps) {
  const session = await readSpotifySessionFromCookies();

  if (!session) {
    redirect("/login");
  }

  const resolvedSearchParams = searchParams ? await searchParams : {};
  const queue = await buildLibraryQueue();
  const filters = parseLibraryQueueFilters(resolvedSearchParams);
  const records = sortQueueRecords(filterQueueRecords(queue.tracks, filters), filters.sort);

  return <LibraryQueueView queue={queue} records={records} filters={filters} />;
}
