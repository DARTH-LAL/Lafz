import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { LoginHero } from "@/components/login-hero";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";
import { getSpotifyAppOriginOrNull } from "@/lib/env";

export const dynamic = "force-dynamic";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function buildSearchString(searchParams: Record<string, string | string[] | undefined>) {
  const nextSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        nextSearchParams.append(key, entry);
      }
      continue;
    }

    if (typeof value === "string") {
      nextSearchParams.set(key, value);
    }
  }

  const serialized = nextSearchParams.toString();
  return serialized ? `?${serialized}` : "";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const canonicalAppOrigin = getSpotifyAppOriginOrNull();
  const requestHeaders = await headers();
  const currentHost = requestHeaders.get("host");

  if (canonicalAppOrigin && currentHost && new URL(canonicalAppOrigin).host !== currentHost) {
    const resolvedSearchParams = searchParams ? await searchParams : {};
    redirect(`${canonicalAppOrigin}/login${buildSearchString(resolvedSearchParams)}`);
  }

  const session = await readSpotifySessionFromCookies();

  if (session) {
    redirect(canonicalAppOrigin ? `${canonicalAppOrigin}/` : "/");
  }

  return <LoginHero canonicalAppOrigin={canonicalAppOrigin} />;
}
