import { NextRequest, NextResponse } from "next/server";

import { buildSpotifyAuthorizeUrl, createSpotifyAuthState } from "@/features/spotify/auth";
import { writeSpotifyState } from "@/features/spotify/session";

export async function GET(request: NextRequest) {
  try {
    const state = createSpotifyAuthState();
    const response = NextResponse.redirect(buildSpotifyAuthorizeUrl(state));

    // Persist a short-lived state value in an HTTP-only cookie so the callback can verify the auth roundtrip.
    writeSpotifyState(response, state);

    return response;
  } catch {
    return NextResponse.redirect(new URL("/login?error=missing_env", request.url));
  }
}
