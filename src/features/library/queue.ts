import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { inspectAiTranslationDraftFile } from "@/features/ai/repository";
import { deriveStudioStatus } from "@/features/library/studio-status";
import { inspectLyricsCache } from "@/features/lyrics/repository";
import type { LafzLibraryPlaylistFile, LafzLibraryTrack, TranslationStatus } from "@/features/spotify/types";
import { inspectTranslationFile } from "@/features/translations/inspection";
import { createTranslationStubFile } from "@/features/translations/stubs";
import type {
  LibraryQueueFilters,
  LibraryQueueRecord,
  LibraryQueueResult,
  LibraryQueueSummary,
  LibraryQueueWarning,
  LibrarySourcePlaylist,
  QueueSortOption
} from "@/features/library/types";

const libraryPlaylistsRoot = path.join(process.cwd(), "data", "library", "playlists");
const libraryStatusPriority: Record<TranslationStatus, number> = {
  pending: 0,
  in_progress: 1,
  translated: 2
};
const studioStatusPriority = {
  needs_lyrics: 0,
  lyrics_ready: 1,
  needs_review: 2,
  reviewed: 3,
  synced: 4,
  published: 5
} as const;

type SearchParamsInput = Record<string, string | string[] | undefined>;

type QueueRecordSeed = {
  spotify_track_id: string;
  title: string;
  artist: string;
  album: string;
  album_art_url: string | null;
  duration_ms: number;
  source_playlists: Map<string, LibrarySourcePlaylist>;
  language: string | null;
  explicit_translation_status: TranslationStatus | null;
  spotify_track_url: string | null;
};

async function ensureTranslationFilesForSeeds(seeds: Iterable<QueueRecordSeed>) {
  await Promise.all(
    [...seeds].map((seed) =>
      createTranslationStubFile({
        spotifyTrackId: seed.spotify_track_id,
        language: seed.language,
        overwriteExistingStub: false
      })
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNullableString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asTranslationStatus(value: unknown) {
  return value === "pending" || value === "in_progress" || value === "translated" ? value : null;
}

function getFirstParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function normalizeDisplayLanguage(language: string | null) {
  return language && language.trim().length > 0 ? language : "unknown";
}

function compareStrings(left: string, right: string) {
  return left.localeCompare(right, undefined, {
    sensitivity: "base",
    numeric: true
  });
}

function parseLibraryTrack(value: unknown, filePath: string, index: number): LafzLibraryTrack | null {
  if (!isRecord(value)) {
    throw new Error(`Track at index ${index} in ${filePath} is not a JSON object.`);
  }

  const spotify_track_id = asString(value.spotify_track_id);
  const title = asString(value.title);
  const artist = asString(value.artist);
  const album = asString(value.album);
  const duration_ms = asNumber(value.duration_ms);
  const source_playlist_id = asString(value.source_playlist_id);
  const source_playlist_name = asString(value.source_playlist_name);
  const translation_status = asTranslationStatus(value.translation_status);

  if (!spotify_track_id || !title || !artist || !album || duration_ms === null || !source_playlist_id || !source_playlist_name) {
    throw new Error(`Track at index ${index} in ${filePath} is missing required Lafz library fields.`);
  }

  return {
    spotify_track_id,
    title,
    artist,
    album,
    album_art_url: asNullableString(value.album_art_url),
    duration_ms,
    source_playlist_id,
    source_playlist_name,
    language: asNullableString(value.language),
    translation_status: translation_status ?? "pending",
    spotify_track_url: asNullableString(value.spotify_track_url)
  };
}

function parseLibraryPlaylistFile(value: unknown, filePath: string): LafzLibraryPlaylistFile {
  if (!isRecord(value)) {
    throw new Error(`Playlist library file ${filePath} is not a JSON object.`);
  }

  const playlist_id = asString(value.playlist_id);
  const playlist_name = asString(value.playlist_name);
  const imported_at = asString(value.imported_at);
  const total_tracks_fetched = asNumber(value.total_tracks_fetched);
  const imported_track_count = asNumber(value.imported_track_count);
  const skipped_track_count = asNumber(value.skipped_track_count);
  const tracks = value.tracks;

  if (
    !playlist_id ||
    !playlist_name ||
    !imported_at ||
    total_tracks_fetched === null ||
    imported_track_count === null ||
    skipped_track_count === null ||
    !Array.isArray(tracks)
  ) {
    throw new Error(`Playlist library file ${filePath} is missing required top-level Lafz fields.`);
  }

  return {
    source: "spotify",
    playlist_id,
    playlist_name,
    playlist_url: asNullableString(value.playlist_url),
    owner_display_name: asNullableString(value.owner_display_name),
    imported_at,
    total_tracks_fetched,
    imported_track_count,
    skipped_track_count,
    // Parse local playlist JSON defensively so one malformed file becomes a warning instead of taking down the whole queue.
    tracks: tracks
      .map((track, index) => parseLibraryTrack(track, filePath, index))
      .filter((track): track is LafzLibraryTrack => Boolean(track))
  };
}

async function readLibraryPlaylistFiles() {
  try {
    const fileNames = await readdir(libraryPlaylistsRoot);
    return fileNames.filter((fileName) => fileName.endsWith(".json")).sort(compareStrings);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function buildQueueSummary(records: LibraryQueueRecord[]): LibraryQueueSummary {
  return records.reduce<LibraryQueueSummary>(
    (summary, record) => {
      summary.total_unique_tracks += 1;
      summary[record.studio_status] += 1;
      summary.total_needs_review += record.needs_review_count;
      if (record.ready_to_publish) {
        summary.ready_to_publish += 1;
      }
      return summary;
    },
    {
      total_unique_tracks: 0,
      needs_lyrics: 0,
      lyrics_ready: 0,
      needs_review: 0,
      reviewed: 0,
      synced: 0,
      published: 0,
      ready_to_publish: 0,
      total_needs_review: 0
    }
  );
}

async function hydrateQueueRecord(seed: QueueRecordSeed): Promise<LibraryQueueRecord> {
  const [translationInspection, aiDraftInspection, lyricsInspection] = await Promise.all([
    inspectTranslationFile(seed.spotify_track_id),
    inspectAiTranslationDraftFile(seed.spotify_track_id),
    inspectLyricsCache(seed.spotify_track_id)
  ]);
  const studioStatus = deriveStudioStatus({
    lyricsInspection,
    translationInspection,
    aiDraftInspection
  });
  const timestampCandidates = [translationInspection.lastModifiedAt, aiDraftInspection.lastModifiedAt, lyricsInspection.lastModifiedAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  const reviewDenominator = Math.max(aiDraftInspection.lineCount, aiDraftInspection.highConfidenceCount + aiDraftInspection.mediumConfidenceCount + aiDraftInspection.lowConfidenceCount);

  return {
    spotify_track_id: seed.spotify_track_id,
    title: seed.title,
    artist: seed.artist,
    album: seed.album,
    album_art_url: seed.album_art_url,
    duration_ms: seed.duration_ms,
    source_playlists: [...seed.source_playlists.values()].sort((left, right) => compareStrings(left.playlist_name, right.playlist_name)),
    language: normalizeDisplayLanguage(translationInspection.language ?? seed.language),
    explicit_translation_status: seed.explicit_translation_status,
    studio_status: studioStatus.status,
    studio_status_reason: studioStatus.reason,
    ready_to_publish: studioStatus.readyToPublish,
    published: studioStatus.published,
    lyrics_kind: lyricsInspection.kind,
    lyrics_language: lyricsInspection.language,
    lyrics_line_count: lyricsInspection.kind === "plain" ? lyricsInspection.plainLyrics?.split(/\r?\n/).filter((line) => line.trim().length > 0).length ?? 0 : lyricsInspection.lineCount,
    translation_file_exists: translationInspection.exists,
    translation_file_path: translationInspection.filePath,
    translation_line_count:
      translationInspection.lineCount > 0 ? translationInspection.lineCount : aiDraftInspection.mode === "synced" ? aiDraftInspection.lineCount : 0,
    translation_last_modified_at: translationInspection.lastModifiedAt,
    translation_parse_error: translationInspection.parseError,
    ai_draft_exists: aiDraftInspection.exists,
    ai_draft_line_count: aiDraftInspection.lineCount,
    ai_draft_mode: aiDraftInspection.mode,
    ai_draft_model: aiDraftInspection.model,
    low_confidence_count: aiDraftInspection.lowConfidenceCount,
    medium_confidence_count: aiDraftInspection.mediumConfidenceCount,
    high_confidence_count: aiDraftInspection.highConfidenceCount,
    manual_review_count: aiDraftInspection.manualReviewCount,
    needs_review_count: studioStatus.needsReviewCount,
    review_completion_ratio:
      reviewDenominator > 0 ? Math.min(1, (aiDraftInspection.highConfidenceCount + aiDraftInspection.manualReviewCount) / reviewDenominator) : studioStatus.reviewCompletionRatio,
    last_activity_at: timestampCandidates.length > 0 ? new Date(Math.max(...timestampCandidates)).toISOString() : null,
    spotify_track_url: seed.spotify_track_url
  };
}

export async function buildLibraryQueue(): Promise<LibraryQueueResult> {
  const fileNames = await readLibraryPlaylistFiles();
  const warnings: LibraryQueueWarning[] = [];
  const queueSeeds = new Map<string, QueueRecordSeed>();

  for (const fileName of fileNames) {
    const filePath = path.join(libraryPlaylistsRoot, fileName);

    try {
      const fileContents = await readFile(filePath, "utf8");
      const parsedJson = JSON.parse(fileContents) as unknown;
      const playlistFile = parseLibraryPlaylistFile(parsedJson, filePath);
      const sourcePlaylist: LibrarySourcePlaylist = {
        playlist_id: playlistFile.playlist_id,
        playlist_name: playlistFile.playlist_name,
        playlist_url: playlistFile.playlist_url
      };

      for (const track of playlistFile.tracks) {
        const existingRecord = queueSeeds.get(track.spotify_track_id);

        if (!existingRecord) {
          queueSeeds.set(track.spotify_track_id, {
            spotify_track_id: track.spotify_track_id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            album_art_url: track.album_art_url,
            duration_ms: track.duration_ms,
            source_playlists: new Map([[sourcePlaylist.playlist_id, sourcePlaylist]]),
            language: track.language,
            explicit_translation_status: track.translation_status,
            spotify_track_url: track.spotify_track_url
          });
          continue;
        }

        existingRecord.source_playlists.set(sourcePlaylist.playlist_id, sourcePlaylist);

        if ((!existingRecord.language || existingRecord.language === "unknown") && track.language && track.language !== "unknown") {
          existingRecord.language = track.language;
        }

        if (
          track.translation_status &&
          existingRecord.explicit_translation_status &&
          libraryStatusPriority[track.translation_status] > libraryStatusPriority[existingRecord.explicit_translation_status]
        ) {
          existingRecord.explicit_translation_status = track.translation_status;
        }

        if (!existingRecord.spotify_track_url && track.spotify_track_url) {
          existingRecord.spotify_track_url = track.spotify_track_url;
        }
      }
    } catch (error) {
      warnings.push({
        source: filePath,
        message: error instanceof Error ? error.message : "Could not read playlist library JSON."
      });
    }
  }

  await ensureTranslationFilesForSeeds(queueSeeds.values());

  const records = await Promise.all([...queueSeeds.values()].map((seed) => hydrateQueueRecord(seed)));
  const sortedRecords = sortQueueRecords(records, "status");
  const languages = [...new Set(sortedRecords.map((record) => record.language))].sort(compareStrings);
  const playlists = [
    ...sortedRecords
      .reduce((playlistMap, record) => {
        for (const playlist of record.source_playlists) {
          playlistMap.set(playlist.playlist_id, playlist);
        }

        return playlistMap;
      }, new Map<string, LibrarySourcePlaylist>())
      .values()
  ].sort((left, right) => compareStrings(left.playlist_name, right.playlist_name));

  return {
    tracks: sortedRecords,
    warnings,
    summary: buildQueueSummary(sortedRecords),
    filterOptions: {
      languages,
      playlists
    }
  };
}

export function parseLibraryQueueFilters(searchParams: SearchParamsInput): LibraryQueueFilters {
  const statusValue = getFirstParamValue(searchParams.status);
  const sortValue = getFirstParamValue(searchParams.sort);

  return {
    search: getFirstParamValue(searchParams.q).trim(),
    status:
      statusValue === "needs_lyrics" ||
      statusValue === "lyrics_ready" ||
      statusValue === "needs_review" ||
      statusValue === "reviewed" ||
      statusValue === "synced" ||
      statusValue === "published"
        ? statusValue
        : "all",
    language: getFirstParamValue(searchParams.language),
    playlist: getFirstParamValue(searchParams.playlist),
    sort:
      sortValue === "title" ||
      sortValue === "artist" ||
      sortValue === "recently_updated" ||
      sortValue === "status" ||
      sortValue === "needs_review"
        ? sortValue
        : "status"
  };
}

export function filterQueueRecords(records: LibraryQueueRecord[], filters: LibraryQueueFilters) {
  const searchTerm = filters.search.toLowerCase();

  return records.filter((record) => {
    if (filters.status !== "all" && record.studio_status !== filters.status) {
      return false;
    }

    if (filters.language && filters.language !== "all" && record.language !== filters.language) {
      return false;
    }

    if (
      filters.playlist &&
      filters.playlist !== "all" &&
      !record.source_playlists.some((playlist) => playlist.playlist_id === filters.playlist)
    ) {
      return false;
    }

    if (!searchTerm) {
      return true;
    }

    const searchableText = [
      record.title,
      record.artist,
      record.album,
      record.spotify_track_id,
      record.language,
      ...record.source_playlists.map((playlist) => playlist.playlist_name)
    ]
      .join(" ")
      .toLowerCase();

    return searchableText.includes(searchTerm);
  });
}

export function sortQueueRecords(records: LibraryQueueRecord[], sort: QueueSortOption) {
  return [...records].sort((left, right) => {
    if (sort === "title") {
      return compareStrings(left.title, right.title) || compareStrings(left.artist, right.artist);
    }

    if (sort === "artist") {
      return compareStrings(left.artist, right.artist) || compareStrings(left.title, right.title);
    }

    if (sort === "recently_updated") {
      const leftTime = left.last_activity_at ? new Date(left.last_activity_at).getTime() : -1;
      const rightTime = right.last_activity_at ? new Date(right.last_activity_at).getTime() : -1;

      return rightTime - leftTime || compareStrings(left.title, right.title);
    }

    if (sort === "needs_review") {
      return right.needs_review_count - left.needs_review_count || compareStrings(left.title, right.title);
    }

    return (
      studioStatusPriority[left.studio_status] - studioStatusPriority[right.studio_status] ||
      right.needs_review_count - left.needs_review_count ||
      compareStrings(left.title, right.title)
    );
  });
}

export async function getLibraryTrackRecord(spotifyTrackId: string) {
  const queue = await buildLibraryQueue();

  return {
    record: queue.tracks.find((track) => track.spotify_track_id === spotifyTrackId) ?? null,
    warnings: queue.warnings
  };
}
