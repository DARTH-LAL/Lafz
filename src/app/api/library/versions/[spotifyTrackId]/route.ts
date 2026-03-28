import { NextRequest, NextResponse } from "next/server";

import { listDraftVersions, getDraftVersion } from "@/features/ai/versioning";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteParams = { params: Promise<{ spotifyTrackId: string }> };

/** GET /api/library/versions/[spotifyTrackId]?ts=123 — list all or fetch one */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const session = readSpotifySessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { spotifyTrackId } = await params;
  const ts = request.nextUrl.searchParams.get("ts");

  if (ts) {
    const version = await getDraftVersion(spotifyTrackId, Number(ts));
    if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
    return NextResponse.json(version);
  }

  const versions = await listDraftVersions(spotifyTrackId);
  return NextResponse.json({ versions });
}
