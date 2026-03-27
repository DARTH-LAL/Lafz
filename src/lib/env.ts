const REQUIRED_SERVER_ENV = [
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
  "SPOTIFY_REDIRECT_URI"
] as const;

type RequiredServerEnv = (typeof REQUIRED_SERVER_ENV)[number];

function getRequiredEnv(name: RequiredServerEnv): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getSpotifyServerEnv() {
  return {
    clientId: getRequiredEnv("SPOTIFY_CLIENT_ID"),
    clientSecret: getRequiredEnv("SPOTIFY_CLIENT_SECRET"),
    redirectUri: getRequiredEnv("SPOTIFY_REDIRECT_URI")
  };
}

export function getSpotifyAppOrigin() {
  return new URL(getSpotifyServerEnv().redirectUri).origin;
}

export function getSpotifyAppOriginOrNull() {
  try {
    return getSpotifyAppOrigin();
  } catch {
    return null;
  }
}

export function isSecureCookieEnvironment() {
  return process.env.NODE_ENV === "production";
}

// Optional — Genius is a fallback lyrics provider. The app works without it;
// lrclib is tried first and the manual paste form is always available.
export function getGeniusAccessToken(): string | null {
  const value = process.env.GENIUS_ACCESS_TOKEN;
  return value && value.trim().length > 0 ? value.trim() : null;
}
