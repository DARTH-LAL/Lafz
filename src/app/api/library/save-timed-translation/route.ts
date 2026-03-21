import { NextRequest, NextResponse } from "next/server";

import { readSpotifySessionFromRequest } from "@/features/spotify/session";
import { buildTrackTranslationFromTimingEditor } from "@/features/timing/editor";
import type { TimingEditorDocument, TimingEditorLine } from "@/features/timing/types";
import { writeTrackTranslationFile } from "@/features/translations/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseTimingLine(value: unknown, index: number): TimingEditorLine {
  if (!isRecord(value)) {
    throw new Error(`Line ${index + 1} is not a JSON object.`);
  }

  const order = asNumber(value.order);
  const original = asString(value.original);
  const translated = asString(value.translated);
  const transliteration = value.transliteration === null ? null : asString(value.transliteration);
  const note = value.note === null ? null : asString(value.note);
  const startMs = value.startMs === null ? null : asNumber(value.startMs);
  const endMs = value.endMs === null ? null : asNumber(value.endMs);

  if (order === null || original === null || translated === null) {
    throw new Error(`Line ${index + 1} is missing required timing editor fields.`);
  }

  return {
    order,
    original,
    translated,
    transliteration,
    note,
    startMs,
    endMs
  };
}

function parseTimingEditorDocument(value: unknown): TimingEditorDocument {
  if (!isRecord(value)) {
    throw new Error("Timing editor payload is not a JSON object.");
  }

  const spotifyTrackId = asString(value.spotifyTrackId);
  const title = asString(value.title);
  const artist = asString(value.artist);
  const album = asString(value.album);
  const sourceLanguage = asString(value.sourceLanguage);
  const targetLanguage = asString(value.targetLanguage);
  const durationMs = asNumber(value.durationMs);
  const source =
    value.source === "translation" || value.source === "ai_draft" || value.source === "lyrics_cache" ? value.source : null;
  const lines = Array.isArray(value.lines) ? value.lines.map((line, index) => parseTimingLine(line, index)) : null;

  if (!spotifyTrackId || !title || !artist || !album || !sourceLanguage || !targetLanguage || durationMs === null || !source || !lines) {
    throw new Error("Timing editor payload is missing required track fields.");
  }

  return {
    spotifyTrackId,
    title,
    artist,
    album,
    sourceLanguage,
    targetLanguage,
    durationMs,
    source,
    lines
  };
}

export async function POST(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);

  if (!session) {
    return NextResponse.json({ error: "Spotify session not found." }, { status: 401 });
  }

  try {
    const payload = parseTimingEditorDocument((await request.json()) as unknown);
    const { translation, savedLineCount, skippedLineCount } = buildTrackTranslationFromTimingEditor(payload);
    const translationFilePath = await writeTrackTranslationFile(translation);

    return NextResponse.json({
      success: true,
      translationFilePath,
      savedLineCount,
      skippedLineCount
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to save the timed translation."
      },
      { status: 400 }
    );
  }
}
