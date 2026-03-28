import { NextRequest, NextResponse } from "next/server";

import { readGenerationLog } from "@/features/ai/generation-log";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteParams = { params: Promise<{ spotifyTrackId: string }> };

/** GET /api/library/generation-log/[spotifyTrackId] */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = readSpotifySessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { spotifyTrackId } = await params;
  const entries = await readGenerationLog(spotifyTrackId);
  return NextResponse.json({ entries });
}
