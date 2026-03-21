import { NextRequest, NextResponse } from "next/server";

import { generateAiTranslationDraft } from "@/features/ai/translation-draft";
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

function asBoolean(value: FormDataEntryValue | null) {
  return value === "on";
}

function sanitizeRedirectTo(value: string | null) {
  if (value && value.startsWith("/") && !value.startsWith("//")) {
    return value;
  }

  return "/library/queue";
}

function sanitizeAiDetail(value: string) {
  return value.trim().slice(0, 180);
}

function withAiStatus(redirectTo: string, status: string, detail?: string) {
  const redirectUrl = new URL(redirectTo, "http://lafz.local");
  redirectUrl.searchParams.set("ai", status);
  if (detail) {
    redirectUrl.searchParams.set("aiDetail", sanitizeAiDetail(detail));
  } else {
    redirectUrl.searchParams.delete("aiDetail");
  }
  return `${redirectUrl.pathname}${redirectUrl.search}`;
}

function redirectWithStatus(request: NextRequest, redirectTo: string, status: string, detail?: string) {
  return NextResponse.redirect(new URL(withAiStatus(redirectTo, status, detail), request.url), 303);
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
  const sourceLanguage = asNonEmptyString(formData.get("sourceLanguage"));
  const targetLanguage = asNonEmptyString(formData.get("targetLanguage"));
  const durationMs = asPositiveNumber(formData.get("durationMs"));
  const includeTransliteration = asBoolean(formData.get("includeTransliteration"));
  const includeNotes = asBoolean(formData.get("includeNotes"));
  const overwriteExistingTranslation = asBoolean(formData.get("overwriteExistingTranslation"));
  const redirectTo = sanitizeRedirectTo(asNonEmptyString(formData.get("redirectTo")));

  if (!spotifyTrackId || !title || !artist || !album || !targetLanguage || durationMs === null) {
    return redirectWithStatus(request, redirectTo, "error");
  }

  try {
    const result = await generateAiTranslationDraft({
      spotifyTrackId,
      title,
      artist,
      album,
      durationMs,
      sourceLanguage,
      targetLanguage,
      includeTransliteration,
      includeNotes,
      overwriteExistingTranslation
    });

    return redirectWithStatus(request, redirectTo, result.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown AI error.";

    if (/could not reach ollama|could not reach openai|econnrefused|fetch failed|connect/i.test(message)) {
      return redirectWithStatus(request, redirectTo, "provider_unavailable", message);
    }

    if (/model .*not found|pull .*first|not installed|does not exist/i.test(message)) {
      return redirectWithStatus(request, redirectTo, "model_missing", message);
    }

    return redirectWithStatus(request, redirectTo, "error", message);
  }
}
