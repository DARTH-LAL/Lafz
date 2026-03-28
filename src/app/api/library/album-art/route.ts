import { NextRequest, NextResponse } from "next/server";

import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SpotifyTracksResponse = {
  tracks?: Array<{
    id?: string | null;
    album?: {
      images?: Array<{ url?: string; width?: number; height?: number }>;
    };
  } | null>;
};

/**
 * GET /api/library/album-art?ids=id1,id2,...
 * Fetches album art URLs from Spotify for up to 50 track IDs at once.
 * Returns { [spotifyTrackId]: url | null }
 */
export async function GET(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Spotify session expired." }, { status: 401 });
  }

  const idsParam = request.nextUrl.searchParams.get("ids") ?? "";
  const ids = idsParam
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9]{10,30}$/.test(id))
    .slice(0, 50); // Spotify max

  if (ids.length === 0) {
    return NextResponse.json({});
  }

  try {
    const response = await fetch(
      `https://api.spotify.com/v1/tracks?ids=${ids.join(",")}&market=from_token`,
      {
        headers: { Authorization: `Bearer ${session.accessToken}` },
        cache: "no-store"
      }
    );

    if (!response.ok) {
      return NextResponse.json({}, { status: response.status });
    }

    const data = (await response.json()) as SpotifyTracksResponse;
    const result: Record<string, string | null> = {};

    for (const track of data.tracks ?? []) {
      if (track?.id) {
        result[track.id] = track.album?.images?.[0]?.url ?? null;
      }
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, max-age=86400" } // cache for 24h
    });
  } catch {
    return NextResponse.json({});
  }
}
