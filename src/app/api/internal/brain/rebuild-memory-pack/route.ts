import { NextRequest, NextResponse } from "next/server";
import { buildSongTranslationMemoryPack } from "@/features/brain/memory-pack";
import { buildMemoryPackCacheKey, splitArtistCredits } from "@/features/brain/normalize";
import { getAiTranslationDraftByTrackId } from "@/features/ai/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readSecretFromRequest(request: NextRequest) {
  const authorization = request.headers.get("authorization")?.trim();

  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return request.headers.get("x-lafz-agent-secret")?.trim() ?? null;
}

function isAuthorized(request: NextRequest) {
  const expectedSecret = process.env.LAFZ_AGENT_RUNNER_SECRET?.trim();

  if (!expectedSecret) {
    return false;
  }

  return readSecretFromRequest(request) === expectedSecret;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const spotifyTrackId =
    typeof body?.spotifyTrackId === "string" && body.spotifyTrackId.trim().length > 0
      ? body.spotifyTrackId.trim()
      : null;

  if (!spotifyTrackId) {
    return NextResponse.json({ error: "spotifyTrackId is required" }, { status: 400 });
  }

  const draft = await getAiTranslationDraftByTrackId(spotifyTrackId).catch(() => null);

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  const artist =
    typeof body?.artist === "string" && body.artist.trim().length > 0 ? body.artist.trim() : draft.artist;
  const candidateTexts = draft.lines.slice(0, 24).map((line) => line.original);
  const pack = await buildSongTranslationMemoryPack({
    spotifyTrackId,
    artist,
    candidateTexts,
    forceRefresh: true
  });
  const cacheKey = buildMemoryPackCacheKey(
    splitArtistCredits(artist).map((entry) => entry.key),
    spotifyTrackId,
    candidateTexts
  );

  return NextResponse.json({
    ok: true,
    spotifyTrackId,
    artist,
    cacheKey,
    pack
  });
}
