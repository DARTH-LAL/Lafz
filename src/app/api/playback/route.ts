import { NextRequest, NextResponse } from "next/server";

import { ensureCleanupAgentWorkerStarted } from "@/features/brain/cleanup-agent";
import { ensureEntityAgentWorkerStarted } from "@/features/brain/entity-agent";
import { ensureMotifAgentWorkerStarted } from "@/features/brain/motif-agent";
import { ensurePersonaAgentWorkerStarted } from "@/features/brain/persona-agent";
import { ensureVocabularyAgentWorkerStarted } from "@/features/brain/vocabulary-agent";
import {
  buildTrackTranslationFromAiDraft,
  findAiTranslationDraftByMetadata,
  getAiTranslationDraftByTrackId
} from "@/features/ai/repository";
import { serializeAiDraftForPlayback } from "@/features/ai/serialize";
import { fetchCurrentSpotifyPlayback, SpotifyUnauthorizedError } from "@/features/spotify/playback";
import { refreshSpotifySession } from "@/features/spotify/server-session";
import {
  clearSpotifySession,
  isSpotifySessionExpiring,
  readSpotifySessionFromRequest,
  writeSpotifySession
} from "@/features/spotify/session";
import type { PlaybackApiResponse } from "@/features/spotify/types";
import { findTranslationByMetadata, getTranslationByTrackId, getTranslationFileHint } from "@/features/translations/repository";

export const dynamic = "force-dynamic";

function isConsumerPlaybackRequest(request: NextRequest) {
  return request.nextUrl.searchParams.get("mode") === "consumer";
}

export async function GET(request: NextRequest) {
  const consumerMode = isConsumerPlaybackRequest(request);

  if (!consumerMode) {
    ensureVocabularyAgentWorkerStarted();
    ensureEntityAgentWorkerStarted();
    ensureMotifAgentWorkerStarted();
    ensurePersonaAgentWorkerStarted();
    ensureCleanupAgentWorkerStarted();
  }

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

    if (consumerMode) {
      const consumerResponse = NextResponse.json({
        playback,
        translation: null,
        aiDraft: null,
        translationFileHint: null
      } satisfies PlaybackApiResponse);

      if (sessionWasRefreshed) {
        writeSpotifySession(consumerResponse, session);
      }

      return consumerResponse;
    }

    if (playback.track) {
      const [exactTranslation, exactAiDraft] = await Promise.all([
        getTranslationByTrackId(playback.track.spotifyTrackId),
        getAiTranslationDraftByTrackId(playback.track.spotifyTrackId)
      ]);
      const [fallbackTranslation, fallbackAiDraft] =
        exactTranslation || exactAiDraft
          ? [null, null]
          : await Promise.all([
              findTranslationByMetadata({
                title: playback.track.title,
                artist: playback.track.artist
              }),
              findAiTranslationDraftByMetadata({
                title: playback.track.title,
                artist: playback.track.artist,
                album: playback.track.album
              })
            ]);
      const translation = exactTranslation ?? fallbackTranslation;
      const aiDraft = exactAiDraft ?? fallbackAiDraft;
      const resolvedTranslation = translation ?? (aiDraft ? buildTrackTranslationFromAiDraft(aiDraft) : null);
      const response = NextResponse.json({
        playback,
        translation: resolvedTranslation,
        aiDraft: aiDraft
          ? serializeAiDraftForPlayback(aiDraft)
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

        if (consumerMode) {
          const consumerResponse = NextResponse.json({
            playback,
            translation: null,
            aiDraft: null,
            translationFileHint: null
          } satisfies PlaybackApiResponse);

          writeSpotifySession(consumerResponse, session);
          return consumerResponse;
        }

        const [exactTranslation, exactAiDraft] = playback.track
          ? await Promise.all([
              getTranslationByTrackId(playback.track.spotifyTrackId),
              getAiTranslationDraftByTrackId(playback.track.spotifyTrackId)
            ])
          : [null, null];
        const [fallbackTranslation, fallbackAiDraft] =
          playback.track && !(exactTranslation || exactAiDraft)
            ? await Promise.all([
                findTranslationByMetadata({
                  title: playback.track.title,
                  artist: playback.track.artist
                }),
                findAiTranslationDraftByMetadata({
                  title: playback.track.title,
                  artist: playback.track.artist,
                  album: playback.track.album
                })
              ])
            : [null, null];
        const translation = exactTranslation ?? fallbackTranslation;
        const aiDraft = exactAiDraft ?? fallbackAiDraft;
        const resolvedTranslation = translation ?? (aiDraft ? buildTrackTranslationFromAiDraft(aiDraft) : null);
        const response = NextResponse.json({
          playback,
          translation: resolvedTranslation,
          aiDraft: aiDraft
            ? serializeAiDraftForPlayback(aiDraft)
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
    console.error("[playback] Spotify error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
