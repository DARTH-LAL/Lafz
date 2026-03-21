import { SPOTIFY_ACCOUNTS_BASE_URL, SPOTIFY_SCOPES } from "@/features/spotify/config";
import { getSpotifyServerEnv } from "@/lib/env";
import type { SpotifyAuthTokenResponse } from "@/features/spotify/types";

export function createSpotifyAuthState() {
  return crypto.randomUUID().replace(/-/g, "");
}

export function buildSpotifyAuthorizeUrl(state: string) {
  const { clientId, redirectUri } = getSpotifyServerEnv();

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SPOTIFY_SCOPES.join(" "),
    state
  });

  return `${SPOTIFY_ACCOUNTS_BASE_URL}/authorize?${params.toString()}`;
}

function buildBasicAuthHeader() {
  const { clientId, clientSecret } = getSpotifyServerEnv();
  const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  return `Basic ${encoded}`;
}

async function requestSpotifyTokens(params: URLSearchParams) {
  const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE_URL}/api/token`, {
    method: "POST",
    headers: {
      Authorization: buildBasicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString(),
    cache: "no-store"
  });

  const payload = (await response.json().catch(() => null)) as
    | SpotifyAuthTokenResponse
    | { error?: string; error_description?: string }
    | null;

  if (!response.ok || !payload || !("access_token" in payload)) {
    const details = payload && "error_description" in payload ? payload.error_description : "Unknown Spotify token error.";
    throw new Error(`Spotify token request failed: ${details}`);
  }

  return payload;
}

export async function exchangeSpotifyCodeForTokens(code: string) {
  const { redirectUri } = getSpotifyServerEnv();

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri
  });

  return requestSpotifyTokens(params);
}

export async function refreshSpotifyAccessToken(refreshToken: string) {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });

  return requestSpotifyTokens(params);
}
