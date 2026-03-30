import { NextResponse } from "next/server";

import { getTranslationByTrackId } from "@/features/translations/repository";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteParams = { params: Promise<{ spotifyTrackId: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const session = await readSpotifySessionFromCookies();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { spotifyTrackId } = await params;
  const translation = await getTranslationByTrackId(spotifyTrackId);

  if (!translation) {
    return new NextResponse("Translation file not found", { status: 404 });
  }

  return NextResponse.json(translation, {
    headers: {
      "Content-Disposition": `inline; filename="${spotifyTrackId}.json"`
    }
  });
}
