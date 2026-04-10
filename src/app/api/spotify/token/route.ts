import { NextRequest, NextResponse } from "next/server";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";

// Used by the Spotify Web Playback SDK to get a fresh access token
export async function GET(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ accessToken: session.accessToken });
}
