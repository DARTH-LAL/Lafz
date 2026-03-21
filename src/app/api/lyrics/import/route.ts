import { NextRequest, NextResponse } from "next/server";

import { importLocalLyrics } from "@/features/lyrics/repository";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function asNonEmptyString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asPositiveNumber(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sanitizeRedirectTo(value: string | null) {
  if (value && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  return "/library/queue";
}

function withLyricsStatus(redirectTo: string, status: string) {
  const redirectUrl = new URL(redirectTo, "http://lafz.local");
  redirectUrl.searchParams.set("lyrics", status);
  return `${redirectUrl.pathname}${redirectUrl.search}`;
}

function redirectWithStatus(request: NextRequest, redirectTo: string, status: string) {
  return NextResponse.redirect(new URL(withLyricsStatus(redirectTo, status), request.url), 303);
}

export async function POST(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);

  if (!session) {
    return NextResponse.redirect(new URL("/login?reason=session_expired", request.url), 303);
  }

  const formData = await request.formData();
  const spotifyTrackId = asNonEmptyString(formData.get("spotifyTrackId"));
  const title = asNonEmptyString(formData.get("title"));
  const artist = asNonEmptyString(formData.get("artist"));
  const album = asNonEmptyString(formData.get("album"));
  const lyricsText = asNonEmptyString(formData.get("lyricsText"));
  const durationMs = asPositiveNumber(formData.get("durationMs"));
  const redirectTo = sanitizeRedirectTo(asNonEmptyString(formData.get("redirectTo")));

  if (!spotifyTrackId || !title || !artist || !album || !lyricsText || durationMs === null) {
    return redirectWithStatus(request, redirectTo, "local_error");
  }

  try {
    await importLocalLyrics({
      spotifyTrackId,
      title,
      artist,
      album,
      durationMs,
      lyricsText
    });

    return redirectWithStatus(request, redirectTo, "local_imported");
  } catch {
    return redirectWithStatus(request, redirectTo, "local_error");
  }
}
