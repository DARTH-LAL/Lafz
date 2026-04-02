import { NextRequest, NextResponse } from "next/server";

import { startAiGenerationJob } from "@/features/ai/job-store";
import { generateAiTranslationDraft } from "@/features/ai/translation-draft";
import { ensureCleanupAgentWorkerStarted } from "@/features/brain/cleanup-agent";
import { ensureEntityAgentWorkerStarted } from "@/features/brain/entity-agent";
import { ensureMotifAgentWorkerStarted } from "@/features/brain/motif-agent";
import { ensurePersonaAgentWorkerStarted } from "@/features/brain/persona-agent";
import { ensureVocabularyAgentWorkerStarted } from "@/features/brain/vocabulary-agent";
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

function wantsJsonResponse(request: NextRequest) {
  return request.headers.get("x-lafz-response") === "json";
}

function getStatusMessage(status: string) {
  if (status === "saved_translation") {
    return "Lafz generated a reviewed AI draft and updated the synced translation file.";
  }

  if (status === "draft_only_plain") {
    return "Lafz generated a reviewed AI draft and kept it on this track page because the lyrics are still untimed.";
  }

  if (status === "draft_only_preserved") {
    return "Lafz generated a reviewed AI draft and preserved the existing translation file.";
  }

  if (status === "missing_lyrics") {
    return "Fetch or import original lyrics before generating a translation draft.";
  }

  if (status === "missing_ai_config") {
    return "Configure the full 3-model translation pipeline before generating a translation draft.";
  }

  if (status === "provider_unavailable") {
    return "Lafz could not reach one of the translation pipeline models right now.";
  }

  if (status === "model_missing") {
    return "The selected AI model is not available yet.";
  }

  return "Lafz could not generate the translation draft right now.";
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
  ensureVocabularyAgentWorkerStarted();
  ensureEntityAgentWorkerStarted();
  ensureMotifAgentWorkerStarted();
  ensurePersonaAgentWorkerStarted();
  ensureCleanupAgentWorkerStarted();

  const session = readSpotifySessionFromRequest(request);

  if (!session) {
    if (wantsJsonResponse(request)) {
      return NextResponse.json({ success: false, status: "session_expired", message: "Spotify session expired." }, { status: 401 });
    }

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
    if (wantsJsonResponse(request)) {
      return NextResponse.json({ success: false, status: "error", message: getStatusMessage("error") }, { status: 400 });
    }

    return redirectWithStatus(request, redirectTo, "error");
  }

  try {
    if (wantsJsonResponse(request)) {
      const job = startAiGenerationJob({
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

      return NextResponse.json(
        {
          success: true,
          status: "started",
          message: "Lafz started generating the AI draft.",
          jobId: job.id
        },
        { status: 202 }
      );
    }

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

    if (/could not reach openai|could not reach anthropic|could not reach gemini|econnrefused|fetch failed|connect|timeout|timed out|aborted/i.test(message)) {
      if (wantsJsonResponse(request)) {
        return NextResponse.json(
          {
            success: false,
            status: "provider_unavailable",
            message: getStatusMessage("provider_unavailable"),
            detail: sanitizeAiDetail(message)
          },
          { status: 503 }
        );
      }

      return redirectWithStatus(request, redirectTo, "provider_unavailable", message);
    }

    if (/model .*not found|pull .*first|not installed|does not exist/i.test(message)) {
      if (wantsJsonResponse(request)) {
        return NextResponse.json(
          {
            success: false,
            status: "model_missing",
            message: getStatusMessage("model_missing"),
            detail: sanitizeAiDetail(message)
          },
          { status: 400 }
        );
      }

      return redirectWithStatus(request, redirectTo, "model_missing", message);
    }

    if (wantsJsonResponse(request)) {
      return NextResponse.json(
        {
          success: false,
          status: "error",
          message: getStatusMessage("error"),
          detail: sanitizeAiDetail(message)
        },
        { status: 500 }
      );
    }

    return redirectWithStatus(request, redirectTo, "error", message);
  }
}
