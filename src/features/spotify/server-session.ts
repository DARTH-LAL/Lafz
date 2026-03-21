import { refreshSpotifyAccessToken } from "@/features/spotify/auth";
import { createSpotifySession, isSpotifySessionExpiring } from "@/features/spotify/session";
import type { SpotifySession } from "@/features/spotify/types";

export async function refreshSpotifySession(session: SpotifySession) {
  const tokenResponse = await refreshSpotifyAccessToken(session.refreshToken);
  return createSpotifySession(tokenResponse, session.refreshToken);
}

export async function ensureFreshSpotifySession(session: SpotifySession) {
  if (!isSpotifySessionExpiring(session)) {
    return {
      session,
      refreshed: false
    };
  }

  return {
    session: await refreshSpotifySession(session),
    refreshed: true
  };
}
