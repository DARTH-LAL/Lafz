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

  const response = await fetch(`${SPOTIFY_API_BASE_URL}/audio-analysis/${trackId}`, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store"
  });

  if (!response.ok) {
    return NextResponse.json({ beats: [] });
  }

  const data = await response.json() as { beats?: Array<{ start: number; duration: number; confidence: number }> };

  // Only return beats — the full analysis payload is huge (~500kb)
  return NextResponse.json({ beats: data.beats ?? [] });
}
