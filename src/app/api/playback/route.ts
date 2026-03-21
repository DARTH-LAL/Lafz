import { NextRequest, NextResponse } from "next/server";

import { inspectAiTranslationDraftFile } from "@/features/ai/repository";
import { fetchCurrentSpotifyPlayback, SpotifyUnauthorizedError } from "@/features/spotify/playback";
import { refreshSpotifySession } from "@/features/spotify/server-session";
import {
  clearSpotifySession,
  isSpotifySessionExpiring,
  readSpotifySessionFromRequest,
  writeSpotifySession
} from "@/features/spotify/session";
import type { PlaybackApiResponse } from "@/features/spotify/types";
import { getTranslationByTrackId, getTranslationFileHint } from "@/features/translations/repository";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const existingSession = readSpotifySessionFromRequest(request);

  if (!existingSession) {
    return NextResponse.json({ error: "Spotify session not found." }, { status: 401 });
  }

  let session = existingSession;
  let sessionWasRefreshed = false;

  try {
    if (isSpotifySessionExpiring(session)) {
      session = await refreshSpotifySession(session);
      sessionWasRefreshed = true;
    }

    let playback = await fetchCurrentSpotifyPlayback(session.accessToken);

    if (playback.track) {
      const [translation, aiDraftInspection] = await Promise.all([
        getTranslationByTrackId(playback.track.spotifyTrackId),
        inspectAiTranslationDraftFile(playback.track.spotifyTrackId)
      ]);
      const response = NextResponse.json({
        playback,
        translation,
        aiDraft:
          aiDraftInspection.exists && (aiDraftInspection.mode === "plain" || aiDraftInspection.mode === "synced")
            ? {
                exists: true,
                lineCount: aiDraftInspection.lineCount,
                mode: aiDraftInspection.mode,
                model: aiDraftInspection.model
              }
            : null,
        translationFileHint: getTranslationFileHint(playback.track.spotifyTrackId)
      } satisfies PlaybackApiResponse);

      if (sessionWasRefreshed) {
        writeSpotifySession(response, session);
      }

      return response;
    }

    const idleResponse = NextResponse.json({
      playback,
      translation: null,
      aiDraft: null,
      translationFileHint: null
    } satisfies PlaybackApiResponse);

    if (sessionWasRefreshed) {
      writeSpotifySession(idleResponse, session);
    }

    return idleResponse;
  } catch (error) {
    if (error instanceof SpotifyUnauthorizedError) {
      try {
        session = await refreshSpotifySession(session);
        sessionWasRefreshed = true;
        const playback = await fetchCurrentSpotifyPlayback(session.accessToken);
        const [translation, aiDraftInspection] = playback.track
          ? await Promise.all([
              getTranslationByTrackId(playback.track.spotifyTrackId),
              inspectAiTranslationDraftFile(playback.track.spotifyTrackId)
            ])
          : [null, null];
        const response = NextResponse.json({
          playback,
          translation,
          aiDraft:
            aiDraftInspection && aiDraftInspection.exists && (aiDraftInspection.mode === "plain" || aiDraftInspection.mode === "synced")
              ? {
                  exists: true,
                  lineCount: aiDraftInspection.lineCount,
                  mode: aiDraftInspection.mode,
                  model: aiDraftInspection.model
                }
              : null,
          translationFileHint: playback.track ? getTranslationFileHint(playback.track.spotifyTrackId) : null
        } satisfies PlaybackApiResponse);

        writeSpotifySession(response, session);
        return response;
      } catch {
        const unauthorizedResponse = NextResponse.json({ error: "Spotify session expired." }, { status: 401 });
        clearSpotifySession(unauthorizedResponse);
        return unauthorizedResponse;
      }
    }

    const message = error instanceof Error ? error.message : "Failed to read Spotify playback state.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
