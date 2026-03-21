import { NextRequest, NextResponse } from "next/server";

import { clearSpotifySession, clearSpotifyState } from "@/features/spotify/session";

function buildLogoutResponse(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/login", request.url));
  clearSpotifySession(response);
  clearSpotifyState(response);
  return response;
}

export async function GET(request: NextRequest) {
  return buildLogoutResponse(request);
}

export async function POST(request: NextRequest) {
  return buildLogoutResponse(request);
}
