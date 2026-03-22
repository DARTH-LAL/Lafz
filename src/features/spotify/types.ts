import type { TrackTranslation } from "@/features/translations/types";

export type SpotifyAuthTokenResponse = {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  refresh_token?: string;
};

export type SpotifySession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type PlaybackStatus = "playing" | "paused" | "idle";

export type NormalizedTrack = {
  spotifyTrackId: string;
  title: string;
  artist: string;
  artistNames: string[];
  album: string;
  albumArtUrl: string | null;
  durationMs: number;
  externalUrl: string | null;
};

export type PlaybackState = {
  status: PlaybackStatus;
  isPlaying: boolean;
  progressMs: number;
  fetchedAt: string;
  deviceName: string | null;
  playbackStateLabel: string;
  track: NormalizedTrack | null;
};

export type PlaybackApiResponse = {
  playback: PlaybackState;
  translation: TrackTranslation | null;
  translationFileHint: string | null;
  aiDraft:
    | {
        exists: boolean;
        lineCount: number;
        mode: "synced" | "plain";
        model: string | null;
        sourceLanguage: string | null;
        targetLanguage: string | null;
        lines: Array<{
          order: number;
          original: string;
          translated: string;
          transliteration: string | null;
          note: string | null;
        }>;
      }
    | null;
};

export type TranslationStatus = "pending" | "in_progress" | "translated";

export type PlaylistImportSkippedReason =
  | "duplicate_track"
  | "local_track"
  | "unavailable_track"
  | "unsupported_item";

export type LafzLibraryTrack = {
  spotify_track_id: string;
  title: string;
  artist: string;
  album: string;
  duration_ms: number;
  source_playlist_id: string;
  source_playlist_name: string;
  language: string | null;
  translation_status: TranslationStatus;
  spotify_track_url: string | null;
};

export type LafzLibraryPlaylistFile = {
  source: "spotify";
  playlist_id: string;
  playlist_name: string;
  playlist_url: string | null;
  owner_display_name: string | null;
  imported_at: string;
  total_tracks_fetched: number;
  imported_track_count: number;
  skipped_track_count: number;
  tracks: LafzLibraryTrack[];
};

export type PlaylistImportOptions = {
  playlistInput: string;
  createMissingTranslationStubs: boolean;
  overwriteExistingStubs: boolean;
};

export type TrackImportOptions = {
  trackInput: string;
  createMissingTranslationStubs: boolean;
  overwriteExistingStubs: boolean;
};

export type PlaylistImportResult = {
  playlistId: string;
  playlistName: string;
  totalTracksFetched: number;
  importedCount: number;
  skippedCount: number;
  stubFilesCreatedCount: number;
  stubFilesOverwrittenCount: number;
  stubFilesSkippedCount: number;
  playlistFilePath: string;
  skippedReasons: Record<PlaylistImportSkippedReason, number>;
};

export type PlaylistImportSuccessResponse = {
  success: true;
  summary: PlaylistImportResult;
};

export type TrackImportStubOutcome = "created" | "overwritten" | "preserved" | "not_requested";

export type TrackImportResult = {
  syntheticLibraryId: string;
  trackId: string;
  trackTitle: string;
  trackArtist: string;
  trackAlbum: string;
  trackDurationMs: number;
  trackUrl: string | null;
  libraryFilePath: string;
  stubFileOutcome: TrackImportStubOutcome;
  stubFilePath: string | null;
};

export type PlaylistImportErrorResponse = {
  success: false;
  status: number;
  error: string;
};

export type PlaylistImportApiResponse = PlaylistImportSuccessResponse | PlaylistImportErrorResponse;

export type TrackImportSuccessResponse = {
  success: true;
  summary: TrackImportResult;
};

export type TrackImportErrorResponse = {
  success: false;
  status: number;
  error: string;
};

export type TrackImportApiResponse = TrackImportSuccessResponse | TrackImportErrorResponse;

export type SpotifyPlaylistImportApiResponse = PlaylistImportApiResponse;
