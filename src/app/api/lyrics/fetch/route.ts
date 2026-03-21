import { NextRequest, NextResponse } from "next/server";

import { fetchOfficialLyrics } from "@/features/lyrics/musixmatch";
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
  const durationMs = asPositiveNumber(formData.get("durationMs"));
  const redirectTo = sanitizeRedirectTo(asNonEmptyString(formData.get("redirectTo")));

  if (!spotifyTrackId || !title || !artist || !album || durationMs === null) {
    return redirectWithStatus(request, redirectTo, "official_error");
  }

  const result = await fetchOfficialLyrics({
    spotifyTrackId,
    title,
    artist,
    album,
    durationMs
  });

  if (result.status === "fetched") {
    return redirectWithStatus(request, redirectTo, "official_fetched");
  }

  if (result.status === "not_found") {
    return redirectWithStatus(request, redirectTo, "official_not_found");
  }

  if (result.status === "missing_provider_config") {
    return redirectWithStatus(request, redirectTo, "official_missing_provider");
  }

  return redirectWithStatus(request, redirectTo, "official_error");
}
