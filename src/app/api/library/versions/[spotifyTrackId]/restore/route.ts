import { NextRequest, NextResponse } from "next/server";

import { getAiTranslationDraftFilePath } from "@/features/ai/repository";
import { restoreDraftVersion } from "@/features/ai/versioning";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteParams = { params: Promise<{ spotifyTrackId: string }> };

/** POST /api/library/versions/[spotifyTrackId]/restore  body: { timestampMs: number } */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = readSpotifySessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { spotifyTrackId } = await params;
  const body = (await request.json().catch(() => ({}))) as { timestampMs?: number };

  if (!body.timestampMs || typeof body.timestampMs !== "number") {
    return NextResponse.json({ error: "timestampMs required" }, { status: 400 });
  }

  const activeDraftPath = getAiTranslationDraftFilePath(spotifyTrackId);
  const ok = await restoreDraftVersion(spotifyTrackId, body.timestampMs, activeDraftPath);

  if (!ok) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
