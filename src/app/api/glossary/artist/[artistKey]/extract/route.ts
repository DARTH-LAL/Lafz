/**
 * POST /api/glossary/artist/[artistKey]/extract
 *
 * Manually trigger glossary extraction from one or more already-generated
 * draft files. Used to backfill suggestions for songs translated before the
 * extractor existed.
 *
 * Body: { spotifyTrackIds: string[] }
 */
import { type NextRequest, NextResponse } from "next/server";

import { getAiGlossaryEntries } from "@/features/ai/glossary";
import { extractAndStoreGlossarySuggestions } from "@/features/ai/glossary-extractor";
import { readArtistGlossaryFile } from "@/features/ai/glossary-repository";
import { getAiTranslationDraftByTrackId } from "@/features/ai/repository";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ artistKey: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await readSpotifySessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { artistKey } = await params;
  const body = (await req.json()) as { spotifyTrackIds?: string[] };
  const trackIds = body.spotifyTrackIds ?? [];

  if (trackIds.length === 0) {
    return NextResponse.json({ error: "spotifyTrackIds array is required and must not be empty." }, { status: 400 });
  }

  const file = await readArtistGlossaryFile(artistKey);
  let extracted = 0;

  for (const spotifyTrackId of trackIds) {
    const draft = await getAiTranslationDraftByTrackId(spotifyTrackId).catch(() => null);
    if (!draft || draft.lines.length === 0) continue;

    const existingGlossary = await getAiGlossaryEntries({
      language: draft.sourceLanguage,
      artist: draft.artist,
    }).catch(() => []);

    await extractAndStoreGlossarySuggestions({
      spotifyTrackId,
      title: draft.title,
      artist: draft.artist,
      sourceLanguage: draft.sourceLanguage,
      lines: draft.lines.map((l) => ({ original: l.original, chosen: l.chosen, meaning: l.meaning })),
      existingGlossary,
    });

    extracted++;
  }

  return NextResponse.json({ success: true, extracted, displayName: file.displayName });
}
