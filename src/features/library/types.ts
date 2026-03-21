import type { TranslationStatus } from "@/features/spotify/types";

export type DerivedQueueStatus = "pending" | "stub" | "translated";
export type QueueSortOption = "title" | "artist" | "recently_updated" | "status";

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
  derived_status: DerivedQueueStatus;
  translation_file_exists: boolean;
  translation_file_path: string;
  translation_line_count: number;
  translation_last_modified_at: string | null;
  translation_parse_error: string | null;
  ai_draft_exists: boolean;
  ai_draft_line_count: number;
  ai_draft_mode: "synced" | "plain" | "missing" | "malformed";
  ai_draft_model: string | null;
  spotify_track_url: string | null;
};

export type LibraryQueueSummary = {
  total_unique_tracks: number;
  pending: number;
  stub: number;
  translated: number;
};

export type LibraryQueueFilters = {
  search: string;
  status: DerivedQueueStatus | "all";
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
