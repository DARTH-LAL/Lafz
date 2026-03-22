import { NextRequest, NextResponse } from "next/server";

import {
  fetchCurrentSpotifyPlayback,
  sendSpotifyPlaybackCommand,
  SpotifyPlaybackControlError,
  SpotifyUnauthorizedError
} from "@/features/spotify/playback";
import { refreshSpotifySession } from "@/features/spotify/server-session";
import {
  clearSpotifySession,
  isSpotifySessionExpiring,
  readSpotifySessionFromRequest,
  writeSpotifySession
} from "@/features/spotify/session";
import type { SpotifyPlaybackCommand } from "@/features/spotify/playback";
import type { SpotifyRepeatMode } from "@/features/spotify/types";

export const dynamic = "force-dynamic";

type ControlRequestBody =
  | { action: "play" | "pause" | "next" | "previous" }
  | { action: "seek"; positionMs: number }
  | { action: "shuffle"; enabled: boolean }
  | { action: "repeat"; mode: SpotifyRepeatMode };

export async function POST(request: NextRequest) {
  const existingSession = readSpotifySessionFromRequest(request);

  if (!existingSession) {
    return NextResponse.json({ error: "Spotify session not found." }, { status: 401 });
  }

  let session = existingSession;
  let sessionWasRefreshed = false;
  let command: SpotifyPlaybackCommand | null = null;

  try {
    const rawBody = (await request.json().catch(() => null)) as ControlRequestBody | null;
    command = validatePlaybackCommand(rawBody);

    if (isSpotifySessionExpiring(session)) {
      session = await refreshSpotifySession(session);
      sessionWasRefreshed = true;
    }

    await sendSpotifyPlaybackCommand(session.accessToken, command);
    const playback = await fetchCurrentSpotifyPlayback(session.accessToken);
    const response = NextResponse.json({ success: true, playback });

    if (sessionWasRefreshed) {
      writeSpotifySession(response, session);
    }

    return response;
  } catch (error) {
    if (error instanceof SpotifyUnauthorizedError) {
      try {
        session = await refreshSpotifySession(session);
        sessionWasRefreshed = true;
        if (!command) {
          throw new Error("Invalid playback command.");
        }

        await sendSpotifyPlaybackCommand(session.accessToken, command);
        const playback = await fetchCurrentSpotifyPlayback(session.accessToken);
        const response = NextResponse.json({ success: true, playback });
        writeSpotifySession(response, session);
        return response;
      } catch {
        const unauthorizedResponse = NextResponse.json({ error: "Spotify session expired." }, { status: 401 });
        clearSpotifySession(unauthorizedResponse);
        return unauthorizedResponse;
      }
    }

    if (error instanceof SpotifyPlaybackControlError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Failed to control Spotify playback." }, { status: 500 });
  }
}

function validatePlaybackCommand(body: ControlRequestBody | null): SpotifyPlaybackCommand {
  if (!body || typeof body !== "object" || !("action" in body)) {
    throw new Error("Invalid playback command.");
  }

  if (
    body.action === "play" ||
    body.action === "pause" ||
    body.action === "next" ||
    body.action === "previous"
  ) {
    return body;
  }

  if (body.action === "seek") {
    if (typeof body.positionMs !== "number" || !Number.isFinite(body.positionMs) || body.positionMs < 0) {
      throw new Error("Seek command requires a non-negative positionMs number.");
    }

    return {
      action: "seek",
      positionMs: Math.floor(body.positionMs)
    };
  }

  if (body.action === "shuffle") {
    if (typeof body.enabled !== "boolean") {
      throw new Error("Shuffle command requires an enabled boolean.");
    }

    return body;
  }

  if (body.action === "repeat") {
    if (body.mode !== "off" && body.mode !== "context" && body.mode !== "track") {
      throw new Error("Repeat command requires one of: off, context, track.");
    }

    return body;
  }

  throw new Error("Unsupported playback command.");
}
