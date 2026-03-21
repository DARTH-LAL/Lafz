import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { TOKEN_REFRESH_BUFFER_MS } from "@/features/spotify/config";
import { isSecureCookieEnvironment } from "@/lib/env";
import type { SpotifyAuthTokenResponse, SpotifySession } from "@/features/spotify/types";

const ACCESS_TOKEN_COOKIE = "lafz_spotify_access_token";
const REFRESH_TOKEN_COOKIE = "lafz_spotify_refresh_token";
const EXPIRES_AT_COOKIE = "lafz_spotify_expires_at";
const STATE_COOKIE = "lafz_spotify_state";

const REFRESH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const STATE_MAX_AGE_SECONDS = 60 * 10;

function baseCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureCookieEnvironment(),
    path: "/"
  };
}

export function createSpotifySession(
  tokenResponse: SpotifyAuthTokenResponse,
  fallbackRefreshToken?: string
): SpotifySession {
  const refreshToken = tokenResponse.refresh_token ?? fallbackRefreshToken;

  if (!refreshToken) {
    throw new Error("Spotify refresh token missing from auth response.");
  }

  return {
    accessToken: tokenResponse.access_token,
    refreshToken,
    expiresAt: Date.now() + tokenResponse.expires_in * 1000
  };
}

function parseSpotifySession(rawAccessToken?: string, rawRefreshToken?: string, rawExpiresAt?: string): SpotifySession | null {
  if (!rawAccessToken || !rawRefreshToken || !rawExpiresAt) {
    return null;
  }

  const expiresAt = Number.parseInt(rawExpiresAt, 10);

  if (!Number.isFinite(expiresAt)) {
    return null;
  }

  return {
    accessToken: rawAccessToken,
    refreshToken: rawRefreshToken,
    expiresAt
  };
}

export async function readSpotifySessionFromCookies() {
  const cookieStore = await cookies();

  return parseSpotifySession(
    cookieStore.get(ACCESS_TOKEN_COOKIE)?.value,
    cookieStore.get(REFRESH_TOKEN_COOKIE)?.value,
    cookieStore.get(EXPIRES_AT_COOKIE)?.value
  );
}

export function readSpotifySessionFromRequest(request: NextRequest) {
  return parseSpotifySession(
    request.cookies.get(ACCESS_TOKEN_COOKIE)?.value,
    request.cookies.get(REFRESH_TOKEN_COOKIE)?.value,
    request.cookies.get(EXPIRES_AT_COOKIE)?.value
  );
}

export function isSpotifySessionExpiring(session: SpotifySession) {
  return Date.now() + TOKEN_REFRESH_BUFFER_MS >= session.expiresAt;
}

export function writeSpotifySession(response: NextResponse, session: SpotifySession) {
  const accessTokenMaxAge = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));

  response.cookies.set(ACCESS_TOKEN_COOKIE, session.accessToken, {
    ...baseCookieOptions(),
    maxAge: accessTokenMaxAge
  });

  response.cookies.set(REFRESH_TOKEN_COOKIE, session.refreshToken, {
    ...baseCookieOptions(),
    maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS
  });

  response.cookies.set(EXPIRES_AT_COOKIE, session.expiresAt.toString(), {
    ...baseCookieOptions(),
    maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS
  });
}

export function clearSpotifySession(response: NextResponse) {
  for (const name of [ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, EXPIRES_AT_COOKIE]) {
    response.cookies.set(name, "", {
      ...baseCookieOptions(),
      maxAge: 0
    });
  }
}

export function writeSpotifyState(response: NextResponse, state: string) {
  response.cookies.set(STATE_COOKIE, state, {
    ...baseCookieOptions(),
    maxAge: STATE_MAX_AGE_SECONDS
  });
}

export function readSpotifyState(request: NextRequest) {
  return request.cookies.get(STATE_COOKIE)?.value ?? null;
}

export function clearSpotifyState(response: NextResponse) {
  response.cookies.set(STATE_COOKIE, "", {
    ...baseCookieOptions(),
    maxAge: 0
  });
}
