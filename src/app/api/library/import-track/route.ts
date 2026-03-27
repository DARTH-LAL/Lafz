import { NextRequest, NextResponse } from "next/server";

import { autoFetchLyrics } from "@/features/lyrics/auto-fetch";
import { importSpotifyTrackLibrary, toTrackImportErrorResponse } from "@/features/spotify/track-import";
import { clearSpotifySession, readSpotifySessionFromRequest, writeSpotifySession } from "@/features/spotify/session";
import { ensureFreshSpotifySession, refreshSpotifySession } from "@/features/spotify/server-session";
import type { LyricsAutoFetchResult, TrackImportApiResponse, TrackImportOptions, TrackImportResult } from "@/features/spotify/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isValidImportOptions(value: unknown): value is TrackImportOptions {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return typeof candidate.trackInput === "string";
}

async function fetchLyricsForTrack(summary: TrackImportResult): Promise<LyricsAutoFetchResult> {
  try {
    const result = await autoFetchLyrics({
      spotifyTrackId: summary.trackId,
      title: summary.trackTitle,
      artist: summary.trackArtist,
      album: summary.trackAlbum,
      durationMs: summary.trackDurationMs
    });

    if (result.status === "fetched_synced") {
      return {
        status: "fetched_synced",
        sourceLabel: result.sourceLabel,
        message: `Found synced lyrics from ${result.sourceLabel}.`
      };
    }

    if (result.status === "fetched_plain") {
      return {
        status: "fetched_plain",
        sourceLabel: result.sourceLabel,
        message: `Found plain lyrics from ${result.sourceLabel}. No timestamps — add timed lyrics later for karaoke sync.`
      };
    }

    return {
      status: "not_found",
      message: "No lyrics found on lrclib or Genius. Paste them manually on the track page."
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Lyrics auto-fetch failed."
    };
  }
}

export async function POST(request: NextRequest) {
  const existingSession = readSpotifySessionFromRequest(request);

  if (!existingSession) {
    return NextResponse.json<TrackImportApiResponse>(
      {
        success: false,
        status: 401,
        error: "Spotify session not found. Sign in again to import songs."
      },
      { status: 401 }
    );
  }

  const requestBody = (await request.json().catch(() => null)) as unknown;

  if (!isValidImportOptions(requestBody)) {
    return NextResponse.json<TrackImportApiResponse>(
      {
        success: false,
        status: 400,
        error: "Invalid single-song import request body."
      },
      { status: 400 }
    );
  }

  let session = existingSession;
  let refreshed = false;

  try {
    const resolvedSession = await ensureFreshSpotifySession(existingSession);
    session = resolvedSession.session;
    refreshed = resolvedSession.refreshed;
  } catch {
    const response = NextResponse.json<TrackImportApiResponse>(
      {
        success: false,
        status: 401,
        error: "Spotify session expired. Disconnect and reconnect Lafz before importing songs."
      },
      { status: 401 }
    );
    clearSpotifySession(response);
    return response;
  }

  try {
    const summary = await importSpotifyTrackLibrary(session.accessToken, requestBody);
    const lyricsAutoFetch = await fetchLyricsForTrack(summary);
    const response = NextResponse.json<TrackImportApiResponse>({
      success: true,
      summary,
      lyricsAutoFetch
    });

    if (refreshed) {
      writeSpotifySession(response, session);
    }

    return response;
  } catch (error) {
    const errorResponse = toTrackImportErrorResponse(error);

    if (errorResponse.status === 401) {
      try {
        session = await refreshSpotifySession(session);
        const summary = await importSpotifyTrackLibrary(session.accessToken, requestBody);
        const lyricsAutoFetch = await fetchLyricsForTrack(summary);
        const response = NextResponse.json<TrackImportApiResponse>({
          success: true,
          summary,
          lyricsAutoFetch
        });

        writeSpotifySession(response, session);
        return response;
      } catch {
        const response = NextResponse.json<TrackImportApiResponse>(
          {
            success: false,
            status: 401,
            error: "Spotify session expired. Disconnect and reconnect Lafz before importing songs."
          },
          { status: 401 }
        );
        clearSpotifySession(response);
        return response;
      }
    }

    return NextResponse.json<TrackImportApiResponse>(errorResponse, {
      status: errorResponse.status
    });
  }
}
