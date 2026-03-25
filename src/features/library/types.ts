import type { TranslationStatus } from "@/features/spotify/types";
import type { LyricsInspectionKind } from "@/features/lyrics/types";

export type StudioQueueStatus = "needs_lyrics" | "lyrics_ready" | "needs_review" | "reviewed" | "synced" | "published";
export type QueueSortOption = "title" | "artist" | "recently_updated" | "status" | "needs_review";

export type LibraryQueueWarning = {
  source: string;
  message: string;
};

export type LibrarySourcePlaylist = {
  playlist_id: string;
  playlist_name: string;
  playlist_url: string | null;
};

export type LibraryQueueRecord = {
  spotify_track_id: string;
  title: string;
  artist: string;
  album: string;
  duration_ms: number;
  source_playlists: LibrarySourcePlaylist[];
  language: string;
  explicit_translation_status: TranslationStatus | null;
  studio_status: StudioQueueStatus;
  studio_status_reason: string;
  ready_to_publish: boolean;
  published: boolean;
  lyrics_kind: LyricsInspectionKind;
  lyrics_language: string | null;
  lyrics_line_count: number;
  translation_file_exists: boolean;
  translation_file_path: string;
  translation_line_count: number;
  translation_last_modified_at: string | null;
  translation_parse_error: string | null;
  ai_draft_exists: boolean;
  ai_draft_line_count: number;
  ai_draft_mode: "synced" | "plain" | "missing" | "malformed";
  ai_draft_model: string | null;
  low_confidence_count: number;
  medium_confidence_count: number;
  high_confidence_count: number;
  manual_review_count: number;
  needs_review_count: number;
  review_completion_ratio: number;
  last_activity_at: string | null;
  spotify_track_url: string | null;
};

export type LibraryQueueSummary = {
  total_unique_tracks: number;
  needs_lyrics: number;
  lyrics_ready: number;
  needs_review: number;
  reviewed: number;
  synced: number;
  published: number;
  ready_to_publish: number;
  total_needs_review: number;
};

export type LibraryQueueFilters = {
  search: string;
  status: StudioQueueStatus | "all";
  language: string;
  playlist: string;
  sort: QueueSortOption;
};

export type LibraryQueueFilterOptions = {
  languages: string[];
  playlists: LibrarySourcePlaylist[];
};

export type LibraryQueueResult = {
  tracks: LibraryQueueRecord[];
  warnings: LibraryQueueWarning[];
  summary: LibraryQueueSummary;
  filterOptions: LibraryQueueFilterOptions;
};
