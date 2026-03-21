import { redirect } from "next/navigation";

import { PlaylistImportClient } from "@/components/playlist-import-client";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";

export const dynamic = "force-dynamic";

export default async function PlaylistImportPage() {
  const session = await readSpotifySessionFromCookies();

  if (!session) {
    redirect("/login");
  }

  return <PlaylistImportClient />;
}
