import { NextRequest, NextResponse } from "next/server";

import { autoFetchLyrics } from "@/features/lyrics/auto-fetch";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function asNonEmptyString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asPositiveNumber(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function POST(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);

  if (!session) {
    return NextResponse.json({ success: false, error: "Spotify session expired." }, { status: 401 });
  }

  const formData = await request.formData();
  const spotifyTrackId = asNonEmptyString(formData.get("spotifyTrackId"));
  const title = asNonEmptyString(formData.get("title"));
  const artist = asNonEmptyString(formData.get("artist"));
  const album = asNonEmptyString(formData.get("album"));
  const durationMs = asPositiveNumber(formData.get("durationMs"));

  if (!spotifyTrackId || !title || !artist || !album || durationMs === null) {
    return NextResponse.json(
      { success: false, status: "invalid_request", error: "Missing required track fields." },
      { status: 400 }
    );
  }

  const result = await autoFetchLyrics({ spotifyTrackId, title, artist, album, durationMs });

  if (result.status === "fetched_synced") {
    return NextResponse.json({
      success: true,
      status: "fetched_synced",
      message: `Lafz found synced (timed) lyrics from ${result.sourceLabel} and saved them to the local cache. The karaoke sync engine is ready to use.`
    });
  }

  if (result.status === "fetched_plain") {
    return NextResponse.json({
      success: true,
      status: "fetched_plain",
      message: `Lafz found plain lyrics from ${result.sourceLabel}. No timestamps — the AI translation pipeline will work but karaoke sync won't until you add timed lyrics.`
    });
  }

  if (result.status === "not_found") {
    return NextResponse.json(
      {
        success: false,
        status: "not_found",
        message:
          "Lafz could not find lyrics on lrclib or Genius for this track. Try pasting them manually below."
      },
      { status: 404 }
    );
  }

  // "error" branch
  return NextResponse.json(
    { success: false, status: "error", error: (result as { status: "error"; message: string }).message },
    { status: 500 }
  );
}
