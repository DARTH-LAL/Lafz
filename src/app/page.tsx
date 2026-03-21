import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { NowPlayingClient } from "@/components/now-playing-client";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";
import { getSpotifyAppOriginOrNull } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const canonicalAppOrigin = getSpotifyAppOriginOrNull();
  const requestHeaders = await headers();
  const currentHost = requestHeaders.get("host");

  if (canonicalAppOrigin && currentHost && new URL(canonicalAppOrigin).host !== currentHost) {
    redirect(canonicalAppOrigin);
  }

  const session = await readSpotifySessionFromCookies();

  if (!session) {
    redirect(canonicalAppOrigin ? `${canonicalAppOrigin}/login` : "/login");
  }

  return <NowPlayingClient />;
}
