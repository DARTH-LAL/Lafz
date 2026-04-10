import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { NowPlayingClient } from "@/components/now-playing-client";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";
import { getSpotifyAppOriginOrNull } from "@/lib/env";

export const dynamic = "force-dynamic";

type ConsumerPageProps = {
  searchParams?: Promise<{
    desktop?: string;
  }>;
};

function isDesktopConsumerMode(searchParams: { desktop?: string } | undefined) {
  return searchParams?.desktop === "1" || searchParams?.desktop === "true";
}

export default async function ConsumerPage({ searchParams }: ConsumerPageProps) {
  const canonicalAppOrigin = getSpotifyAppOriginOrNull();
  const requestHeaders = await headers();
  const currentHost = requestHeaders.get("host");
  const resolvedSearchParams = (await searchParams) ?? undefined;
  const desktopMode = isDesktopConsumerMode(resolvedSearchParams);

  if (!desktopMode && canonicalAppOrigin && currentHost && new URL(canonicalAppOrigin).host !== currentHost) {
    redirect(`${canonicalAppOrigin}/consumer`);
  }

  const session = desktopMode ? null : await readSpotifySessionFromCookies();

  if (!desktopMode && !session) {
    redirect(canonicalAppOrigin ? `${canonicalAppOrigin}/login` : "/login");
  }

  return <NowPlayingClient consumerMode desktopMode={desktopMode} />;
}
