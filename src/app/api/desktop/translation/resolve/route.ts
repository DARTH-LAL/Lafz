import { NextRequest, NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/features/cloud/supabase";
import { getAiTranslationDraftByTrackId, findAiTranslationDraftByMetadata } from "@/features/ai/repository";
import { serializeAiDraftForPlayback } from "@/features/ai/serialize";
import { buildTrackTranslationFromAiDraft } from "@/features/ai/repository";
import { findTranslationByMetadata, getTranslationByTrackId } from "@/features/translations/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const desktopCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function withDesktopCors<T extends NextResponse>(response: T) {
  for (const [header, value] of Object.entries(desktopCorsHeaders)) {
    response.headers.set(header, value);
  }

  return response;
}

export async function OPTIONS() {
  return withDesktopCors(new NextResponse(null, { status: 204 }));
}

export async function GET(request: NextRequest) {
  const trackId = request.nextUrl.searchParams.get("trackId")?.trim() ?? "";
  const title = request.nextUrl.searchParams.get("title")?.trim() ?? "";
  const artist = request.nextUrl.searchParams.get("artist")?.trim() ?? "";
  const album = request.nextUrl.searchParams.get("album")?.trim() ?? "";

  if (!trackId && !title) {
    return withDesktopCors(NextResponse.json(
      { error: "desktop translation lookup requires trackId or title." },
      { status: 400 }
    ));
  }

  let translation = null;
  let aiDraft = null;
  let albumArtUrl: string | null = null;

  if (trackId) {
    [translation, aiDraft] = await Promise.all([
      getTranslationByTrackId(trackId).catch(() => null),
      getAiTranslationDraftByTrackId(trackId).catch(() => null)
    ]);

    const supabase = getSupabaseServerClient();
    if (supabase) {
      const { data, error } = await supabase
        .from("published_translations")
        .select("spotify_track_id, album_art_url")
        .eq("spotify_track_id", trackId)
        .maybeSingle();

      if (!error && typeof data?.album_art_url === "string" && data.album_art_url.trim().length > 0) {
        albumArtUrl = data.album_art_url.trim();
      }
    }
  }

  if (!translation && !aiDraft && title && artist) {
    [translation, aiDraft] = await Promise.all([
      findTranslationByMetadata({ title, artist: artist || null }).catch(() => null),
      findAiTranslationDraftByMetadata({ title, artist: artist || null, album: album || null }).catch(() => null)
    ]);
  }

  if (!translation && !aiDraft && title) {
    [translation, aiDraft] = await Promise.all([
      findTranslationByMetadata({ title, artist: null }).catch(() => null),
      findAiTranslationDraftByMetadata({ title, artist: null, album: album || null }).catch(() => null)
    ]);
  }

  const resolvedTranslation = translation ?? (aiDraft ? buildTrackTranslationFromAiDraft(aiDraft) : null);

  if (!resolvedTranslation && !aiDraft) {
    return withDesktopCors(NextResponse.json({ error: "No matching translation found." }, { status: 404 }));
  }

  return withDesktopCors(NextResponse.json({
    translation: resolvedTranslation,
    aiDraft: aiDraft ? serializeAiDraftForPlayback(aiDraft) : null,
    albumArtUrl
  }));
}
