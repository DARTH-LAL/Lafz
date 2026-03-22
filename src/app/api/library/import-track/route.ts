import { NextRequest, NextResponse } from "next/server";

import { importSpotifyTrackLibrary, toTrackImportErrorResponse } from "@/features/spotify/track-import";
import { clearSpotifySession, readSpotifySessionFromRequest, writeSpotifySession } from "@/features/spotify/session";
import { ensureFreshSpotifySession, refreshSpotifySession } from "@/features/spotify/server-session";
import type { TrackImportApiResponse, TrackImportOptions } from "@/features/spotify/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isValidImportOptions(value: unknown): value is TrackImportOptions {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.trackInput === "string" &&
    typeof candidate.createMissingTranslationStubs === "boolean" &&
    typeof candidate.overwriteExistingStubs === "boolean"
  );
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
    const response = NextResponse.json<TrackImportApiResponse>({
      success: true,
      summary
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
        const response = NextResponse.json<TrackImportApiResponse>({
          success: true,
          summary
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
