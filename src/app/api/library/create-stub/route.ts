import { NextRequest, NextResponse } from "next/server";

import { readSpotifySessionFromRequest } from "@/features/spotify/session";
import { createTranslationStubFile } from "@/features/translations/stubs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function asNonEmptyString(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function sanitizeRedirectTo(value: string | null) {
  if (value && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  return "/library/queue";
}

function withStubStatus(redirectTo: string, status: "created" | "exists" | "error") {
  const redirectUrl = new URL(redirectTo, "http://lafz.local");
  redirectUrl.searchParams.set("stub", status);
  return `${redirectUrl.pathname}${redirectUrl.search}`;
}

function redirectWithStatus(request: NextRequest, redirectTo: string, status: "created" | "exists" | "error") {
  return NextResponse.redirect(new URL(withStubStatus(redirectTo, status), request.url), 303);
}

export async function POST(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);

  if (!session) {
    return NextResponse.redirect(new URL("/login?reason=session_expired", request.url), 303);
  }

  const formData = await request.formData();
  const spotifyTrackId = asNonEmptyString(formData.get("spotifyTrackId"));
  const language = asNonEmptyString(formData.get("language"));
  const redirectTo = sanitizeRedirectTo(asNonEmptyString(formData.get("redirectTo")));

  if (!spotifyTrackId) {
    return redirectWithStatus(request, redirectTo, "error");
  }

  try {
    const result = await createTranslationStubFile({
      spotifyTrackId,
      language,
      overwriteExistingStub: false
    });
    const status = result.created ? "created" : result.skipped ? "exists" : "created";

    return redirectWithStatus(request, redirectTo, status);
  } catch {
    return redirectWithStatus(request, redirectTo, "error");
  }
}
