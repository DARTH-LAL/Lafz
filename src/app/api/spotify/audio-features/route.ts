import { NextRequest, NextResponse } from "next/server";
import { SPOTIFY_API_BASE_URL } from "@/features/spotify/config";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const trackId = request.nextUrl.searchParams.get("trackId");
  if (!trackId) {
    return NextResponse.json({ error: "trackId is required" }, { status: 400 });
  }

  const response = await fetch(`${SPOTIFY_API_BASE_URL}/audio-features/${trackId}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store"
  });

  if (!response.ok) {
    // Spotify restricted audio-features for many apps (Nov 2024) — graceful fallback
    return NextResponse.json({ tempo: 120, timeSignature: 4, energy: 0.5 });
  }

  const data = await response.json() as { tempo?: number; time_signature?: number; energy?: number };

  // Return only what we need — tiny response
  return NextResponse.json({
    tempo: data.tempo ?? 120,
    timeSignature: data.time_signature ?? 4,
    energy: data.energy ?? 0.5,
  });
}
