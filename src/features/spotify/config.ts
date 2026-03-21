export const SPOTIFY_ACCOUNTS_BASE_URL = "https://accounts.spotify.com";
export const SPOTIFY_API_BASE_URL = "https://api.spotify.com/v1";

export const SPOTIFY_SCOPES = [
  "user-read-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative"
] as const;

export const PLAYBACK_POLL_INTERVAL_MS = 4_000;
export const PLAYBACK_UI_TICK_MS = 120;
export const TOKEN_REFRESH_BUFFER_MS = 60_000;
