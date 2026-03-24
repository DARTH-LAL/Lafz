import { NextRequest, NextResponse } from "next/server";

import { learnFromDraftCorrections } from "@/features/ai/correction-memory";
import {
  buildTrackTranslationFromAiDraft,
  getAiTranslationDraftByTrackId,
  writeAiTranslationDraftFile
} from "@/features/ai/repository";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";
import {
  applyManualCorrectionPropagation,
  getChosenLineEditOrdersFromDraft,
} from "@/features/ai/translation-draft";
import { writeTrackTranslationFile } from "@/features/translations/repository";

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
    return NextResponse.json({ error: "Draft payload is not a JSON object." }, { status: 400 });
  }

  const spotifyTrackId = asString(body.spotifyTrackId);
  const lines = Array.isArray(body.lines) ? body.lines : null;

  if (!spotifyTrackId || !lines) {
    return NextResponse.json({ error: "Draft payload is missing the track ID or line updates." }, { status: 400 });
  }

  const existingDraft = await getAiTranslationDraftByTrackId(spotifyTrackId);

  if (!existingDraft) {
    return NextResponse.json({ error: "No AI draft exists yet for this track." }, { status: 404 });
  }

  const updates = new Map<number, { chosen: string; note: string | null; transliteration: string | null }>();

  for (const line of lines) {
    if (!isRecord(line)) {
      return NextResponse.json({ error: "One or more draft line updates are invalid." }, { status: 400 });
    }

    const order = asNumber(line.order);
    const chosen = asString(line.chosen);
    const note = line.note === null || line.note === undefined ? null : asString(line.note);
    const transliteration =
      line.transliteration === null || line.transliteration === undefined ? null : asString(line.transliteration);

    if (order === null || !chosen) {
      return NextResponse.json({ error: "Each draft line update must include order and chosen text." }, { status: 400 });
    }

    updates.set(order, { chosen, note, transliteration });
  }

  const nextDraft = {
    ...existingDraft,
    generatedAt: new Date().toISOString(),
    lines: existingDraft.lines.map((line) => {
      const update = updates.get(line.order);

      if (!update) {
        return line;
      }

      return {
        ...line,
        chosen: update.chosen,
        translated: update.chosen,
        note: update.note,
        transliteration: update.transliteration,
        confidence: "high" as const,
        selectorReason: "Manually reviewed in Lafz."
      };
    })
  };

  const chosenLineEditOrders = getChosenLineEditOrdersFromDraft(existingDraft, nextDraft);
  const learnedCorrections = await learnFromDraftCorrections(existingDraft, nextDraft);
  const finalizedDraft =
    chosenLineEditOrders.length > 0 ? applyManualCorrectionPropagation(nextDraft, chosenLineEditOrders) : nextDraft;

  await writeAiTranslationDraftFile(finalizedDraft);
  const playbackTranslation = buildTrackTranslationFromAiDraft(finalizedDraft);

  if (playbackTranslation) {
    await writeTrackTranslationFile(playbackTranslation);
  }

  const messageParts = ["Saved the AI draft review changes."];

  if (playbackTranslation) {
    messageParts.push("Lafz also refreshed the synced playback translation file.");
  }

  if (chosenLineEditOrders.length > 0) {
    messageParts.push(
      "Lafz saved your edits immediately, propagated matching lines in the same song, and kept your manual corrections locked."
    );
  }

  if (learnedCorrections.count > 0) {
    messageParts.push(
      `Lafz learned from ${learnedCorrections.count} corrected line${learnedCorrections.count === 1 ? "" : "s"} for future song drafts too.`
    );
  }

  return NextResponse.json({
    success: true,
    message: messageParts.join(" ")
  });
}
