import { NextRequest, NextResponse } from "next/server";

import {
  buildTrackTranslationFromAiDraft,
  getAiTranslationDraftByTrackId,
  writeAiTranslationDraftFile
} from "@/features/ai/repository";
import { regenerateDraftLines } from "@/features/ai/translation-draft";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function POST(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);

  if (!session) {
    return NextResponse.json({ error: "Spotify session not found." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as unknown;

  if (!isRecord(body)) {
    return NextResponse.json({ error: "Request body is not a JSON object." }, { status: 400 });
  }

  const spotifyTrackId = asString(body.spotifyTrackId);
  const lineOrder = asNumber(body.lineOrder);

  if (!spotifyTrackId || lineOrder === null) {
    return NextResponse.json(
      { error: "Request body must include spotifyTrackId and lineOrder." },
      { status: 400 }
    );
  }

  const existingDraft = await getAiTranslationDraftByTrackId(spotifyTrackId);

  if (!existingDraft) {
    return NextResponse.json(
      { error: "No AI draft exists for this track." },
      { status: 404 }
    );
  }

  try {
    const { updatedDraft, updatedLines } = await regenerateDraftLines(existingDraft, lineOrder);

    await writeAiTranslationDraftFile(updatedDraft);

    // Keep the playback translation file in sync if the draft is synced
    const playbackTranslation = buildTrackTranslationFromAiDraft(updatedDraft);

    if (playbackTranslation) {
      const { writeTrackTranslationFile } = await import("@/features/translations/repository");
      await writeTrackTranslationFile(playbackTranslation);
    }

    return NextResponse.json({
      success: true,
      updatedLines: updatedLines.map((line) => ({
        order: line.order,
        original: line.original,
        literal: line.literal,
        natural: line.natural,
        slangAware: line.slangAware,
        chosen: line.chosen,
        transliteration: line.transliteration,
        note: line.note,
        ambiguity: line.ambiguity,
        confidence: line.confidence,
        selectorReason: line.selectorReason
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Line regeneration failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
