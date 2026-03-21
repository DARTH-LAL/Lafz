import { NextRequest, NextResponse } from "next/server";

import { exchangeSpotifyCodeForTokens } from "@/features/spotify/auth";
import {
  clearSpotifyState,
  createSpotifySession,
  readSpotifyState,
  writeSpotifySession
} from "@/features/spotify/session";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");
  const storedState = readSpotifyState(request);

  if (error) {
    const declinedResponse = NextResponse.redirect(new URL("/login?error=spotify_declined", request.url));
    clearSpotifyState(declinedResponse);
    return declinedResponse;
  }

  if (!code) {
    const missingCodeResponse = NextResponse.redirect(new URL("/login?error=missing_code", request.url));
    clearSpotifyState(missingCodeResponse);
    return missingCodeResponse;
  }

  if (!state || !storedState || state !== storedState) {
    const invalidStateResponse = NextResponse.redirect(new URL("/login?error=invalid_state", request.url));
    clearSpotifyState(invalidStateResponse);
    return invalidStateResponse;
  }

  try {
    const tokenResponse = await exchangeSpotifyCodeForTokens(code);
    const session = createSpotifySession(tokenResponse);
    const response = NextResponse.redirect(new URL("/", request.url));

    // Store Spotify tokens server-side in HTTP-only cookies so the browser UI never handles the secret or raw tokens directly.
    writeSpotifySession(response, session);
    clearSpotifyState(response);

    return response;
  } catch {
    const failedResponse = NextResponse.redirect(new URL("/login?error=spotify_callback_failed", request.url));
    clearSpotifyState(failedResponse);
    return failedResponse;
  }
}
