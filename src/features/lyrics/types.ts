export type LyricsCacheSource = "musixmatch" | "local_import" | "lrclib" | "genius";
export type LyricsCacheKind = "synced" | "plain";
export type LyricsInspectionKind = LyricsCacheKind | "missing" | "malformed";

export type LyricsCue = {
  startMs: number;
  text: string;
};

export type LyricsCacheFile = {
  spotifyTrackId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  source: LyricsCacheSource;
  sourceLabel: string;
  kind: LyricsCacheKind;
  language: string | null;
  fetchedAt: string;
  providerTrackId: string | null;
  lines: LyricsCue[];
  plainLyrics: string | null;
};

export type LyricsCacheInspection = {
  exists: boolean;
  filePath: string;
  kind: LyricsInspectionKind;
  source: LyricsCacheSource | null;
  sourceLabel: string | null;
  language: string | null;
  lineCount: number;
  lastModifiedAt: string | null;
  preview: string | null;
  parseError: string | null;
  plainLyrics: string | null;
  lines: LyricsCue[];
};

export type LyricsLookupParams = {
  spotifyTrackId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
};

export type LyricsLookupResult =
  | {
      status: "fetched";
      cacheFile: LyricsCacheFile;
    }
  | {
      status: "not_found";
    }
  | {
      status: "missing_provider_config";
    }
  | {
      status: "error";
      message: string;
    };
