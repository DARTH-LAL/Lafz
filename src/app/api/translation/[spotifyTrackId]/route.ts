import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";

import { getLocalTranslationFilePath } from "@/features/translations/stubs";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteParams = { params: Promise<{ spotifyTrackId: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  const session = await readSpotifySessionFromCookies();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { spotifyTrackId } = await params;
  const filePath = getLocalTranslationFilePath(spotifyTrackId);

  try {
    const content = await readFile(filePath, "utf8");
    return new NextResponse(content, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `inline; filename="${spotifyTrackId}.json"`
      }
    });
  } catch {
    return new NextResponse("Translation file not found", { status: 404 });
  }
}
