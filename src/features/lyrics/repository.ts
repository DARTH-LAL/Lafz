import { getCloudDataMetadata, isCloudStorageConfigurationError, listCloudDataObjects, readCloudDataJson, writeCloudDataJson } from "@/features/cloud/data-store";
import { formatCueTimestamp, isLikelyLrcText, parseLrcText } from "@/features/lyrics/lrc";
import type { LyricsCacheFile, LyricsCacheInspection, LyricsCue, LyricsLookupParams } from "@/features/lyrics/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseCue(value: unknown): LyricsCue | null {
  if (!isRecord(value)) {
    return null;
  }

  const startMs = asNumber(value.startMs);
  const text = asString(value.text);

  if (startMs === null || !text) {
    return null;
  }

  return {
    startMs,
    text
  };
}

function parseLyricsCacheFile(value: unknown): LyricsCacheFile {
  if (!isRecord(value)) {
    throw new Error("Lyrics cache file is not a JSON object.");
  }

  const spotifyTrackId = asString(value.spotifyTrackId);
  const title = asString(value.title);
  const artist = asString(value.artist);
  const album = asString(value.album);
  const durationMs = asNumber(value.durationMs);
  const fetchedAt = asString(value.fetchedAt);
  const source =
    value.source === "musixmatch" ||
    value.source === "local_import" ||
    value.source === "lrclib" ||
    value.source === "genius"
      ? value.source
      : null;
  const sourceLabel = asString(value.sourceLabel);
  const kind = value.kind === "synced" || value.kind === "plain" ? value.kind : null;
  const language = typeof value.language === "string" && value.language.trim().length > 0 ? value.language.trim() : null;
  const providerTrackId = typeof value.providerTrackId === "string" && value.providerTrackId.trim().length > 0 ? value.providerTrackId.trim() : null;
  const plainLyrics =
    typeof value.plainLyrics === "string" && value.plainLyrics.trim().length > 0 ? value.plainLyrics.trim() : null;
  const lines = Array.isArray(value.lines) ? value.lines.map(parseCue).filter((line): line is LyricsCue => Boolean(line)) : [];

  if (!spotifyTrackId || !title || !artist || !album || durationMs === null || !fetchedAt || !source || !sourceLabel || !kind) {
    throw new Error("Lyrics cache file is missing required Lafz lyrics fields.");
  }

  return {
    spotifyTrackId,
    title,
    artist,
    album,
    durationMs,
    source,
    sourceLabel,
    kind,
    language,
    fetchedAt,
    providerTrackId,
    lines,
    plainLyrics
  };
}

function buildPreview(cacheFile: LyricsCacheFile) {
  if (cacheFile.kind === "synced" && cacheFile.lines.length > 0) {
    return cacheFile.lines
      .slice(0, 24)
      .map((line) => `${formatCueTimestamp(line.startMs)} ${line.text}`)
      .join("\n");
  }

  if (cacheFile.plainLyrics) {
    return cacheFile.plainLyrics;
  }

  return JSON.stringify(cacheFile, null, 2);
}

function parseTimestampValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?$/);

  if (!match) {
    return null;
  }

  const minutes = Number.parseInt(match[1] ?? "0", 10);
  const seconds = Number.parseInt(match[2] ?? "0", 10);
  const fraction = match[3] ?? "";
  const milliseconds =
    fraction.length === 3 ? Number.parseInt(fraction, 10) : fraction.length === 2 ? Number.parseInt(fraction, 10) * 10 : fraction.length === 1 ? Number.parseInt(fraction, 10) * 100 : 0;

  return minutes * 60_000 + seconds * 1_000 + milliseconds;
}

function extractLineText(value: Record<string, unknown>) {
  return (
    asString(value.text) ??
    asString(value.original) ??
    asString(value.lyric) ??
    asString(value.lyrics) ??
    asString(value.translated) ??
    null
  );
}

function parseLyricsJson(text: string) {
  const parsedJson = JSON.parse(text) as unknown;
  const candidateLines = Array.isArray(parsedJson)
    ? parsedJson
    : isRecord(parsedJson) && Array.isArray(parsedJson.lines)
      ? parsedJson.lines
      : null;

  if (candidateLines) {
    const lines = candidateLines
      .map((line) => {
        if (!isRecord(line)) {
          return null;
        }

        const startMs =
          parseTimestampValue(line.startMs) ??
          parseTimestampValue(line.start) ??
          parseTimestampValue(line.time) ??
          null;
        const textValue = extractLineText(line);

        if (startMs === null || !textValue) {
          return null;
        }

        return {
          startMs,
          text: textValue
        } satisfies LyricsCue;
      })
      .filter((line): line is LyricsCue => Boolean(line))
      .sort((left, right) => left.startMs - right.startMs);

    if (lines.length > 0) {
      return {
        kind: "synced" as const,
        lines,
        plainLyrics: null
      };
    }
  }

  if (isRecord(parsedJson)) {
    const plainLyrics = asString(parsedJson.plainLyrics) ?? asString(parsedJson.lyrics) ?? asString(parsedJson.text);

    if (plainLyrics) {
      return {
        kind: "plain" as const,
        lines: [],
        plainLyrics
      };
    }
  }

  throw new Error("JSON lyrics import did not contain a supported Lafz, LRC, or line-array shape.");
}

function splitPlainLyrics(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function getLyricsCacheFilePath(spotifyTrackId: string) {
  return `data/lyrics/cache/${spotifyTrackId}.json`;
}

export async function writeLyricsCacheFile(cacheFile: LyricsCacheFile) {
  const filePath = getLyricsCacheFilePath(cacheFile.spotifyTrackId);
  await writeCloudDataJson(filePath, cacheFile);
  return filePath;
}

export async function inspectLyricsCache(spotifyTrackId: string): Promise<LyricsCacheInspection> {
  const filePath = getLyricsCacheFilePath(spotifyTrackId);

  try {
    const [rawFile, fileMeta] = await Promise.all([
      readCloudDataJson<unknown>(filePath),
      getCloudDataMetadata(filePath)
    ]);

    if (!rawFile) {
      return {
        exists: false,
        filePath,
        kind: "missing",
        source: null,
        sourceLabel: null,
        language: null,
        lineCount: 0,
        lastModifiedAt: null,
        preview: null,
        parseError: null,
        plainLyrics: null,
        lines: []
      };
    }

    const parsedFile = parseLyricsCacheFile(rawFile);

    return {
      exists: true,
      filePath,
      kind: parsedFile.kind,
      source: parsedFile.source,
      sourceLabel: parsedFile.sourceLabel,
      language: parsedFile.language,
      lineCount: parsedFile.lines.length,
      lastModifiedAt: fileMeta?.lastModifiedAt ?? null,
      preview: buildPreview(parsedFile),
      parseError: null,
      plainLyrics: parsedFile.plainLyrics,
      lines: parsedFile.lines
    };
  } catch (error) {
    if (isCloudStorageConfigurationError(error)) {
      throw error;
    }

    return {
      exists: true,
      filePath,
      kind: "malformed",
      source: null,
      sourceLabel: null,
      language: null,
      lineCount: 0,
      lastModifiedAt: null,
      preview: null,
      parseError: error instanceof Error ? error.message : "Could not parse local lyrics cache JSON.",
      plainLyrics: null,
      lines: []
    };
  }
}

export async function batchInspectLyricsCaches(trackIds: Iterable<string>): Promise<Map<string, LyricsCacheInspection>> {
  const uniqueTrackIds = [...new Set([...trackIds].filter(Boolean))];
  const inspections = new Map<string, LyricsCacheInspection>();

  if (uniqueTrackIds.length === 0) {
    return inspections;
  }

  const objects = await listCloudDataObjects("data/lyrics/cache");
  const objectByTrackId = new Map(
    objects
      .filter((item) => item.key.endsWith(".json"))
      .map((item) => [item.key.split("/").pop()?.replace(/\.json$/i, "") ?? "", item] as const)
  );

  await Promise.all(
    uniqueTrackIds.map(async (trackId) => {
      const object = objectByTrackId.get(trackId);

      if (!object) {
        return;
      }

      try {
        const rawFile = await readCloudDataJson<unknown>(object.key);

        if (!rawFile) {
          return;
        }

        const parsedFile = parseLyricsCacheFile(rawFile);

        inspections.set(trackId, {
          exists: true,
          filePath: getLyricsCacheFilePath(trackId),
          kind: parsedFile.kind,
          source: parsedFile.source,
          sourceLabel: parsedFile.sourceLabel,
          language: parsedFile.language,
          lineCount: parsedFile.lines.length,
          lastModifiedAt: object.lastModifiedAt,
          preview: buildPreview(parsedFile),
          parseError: null,
          plainLyrics: parsedFile.plainLyrics,
          lines: parsedFile.lines
        });
      } catch (error) {
        if (isCloudStorageConfigurationError(error)) {
          throw error;
        }

        inspections.set(trackId, {
          exists: true,
          filePath: getLyricsCacheFilePath(trackId),
          kind: "malformed",
          source: null,
          sourceLabel: null,
          language: null,
          lineCount: 0,
          lastModifiedAt: object.lastModifiedAt,
          preview: null,
          parseError: error instanceof Error ? error.message : "Could not parse local lyrics cache JSON.",
          plainLyrics: null,
          lines: []
        });
      }
    })
  );

  return inspections;
}

export async function getLyricsCacheByTrackId(spotifyTrackId: string) {
  const filePath = getLyricsCacheFilePath(spotifyTrackId);
  const rawFile = await readCloudDataJson<unknown>(filePath);
  return rawFile ? parseLyricsCacheFile(rawFile) : null;
}

export async function importLocalLyrics(options: LyricsLookupParams & { lyricsText: string }) {
  const trimmedLyricsText = options.lyricsText.trim();

  if (!trimmedLyricsText) {
    throw new Error("Paste local lyrics text, LRC, or JSON before importing.");
  }

  const parsedLyrics =
    isLikelyLrcText(trimmedLyricsText)
      ? {
          kind: "synced" as const,
          lines: parseLrcText(trimmedLyricsText),
          plainLyrics: null
        }
      : trimmedLyricsText.startsWith("{") || trimmedLyricsText.startsWith("[")
        ? parseLyricsJson(trimmedLyricsText)
        : {
            kind: "plain" as const,
            lines: [],
            plainLyrics: splitPlainLyrics(trimmedLyricsText)
          };

  if (parsedLyrics.kind === "synced" && parsedLyrics.lines.length === 0) {
    throw new Error("The pasted LRC or JSON did not contain any timed lyric lines.");
  }

  const cacheFile: LyricsCacheFile = {
    spotifyTrackId: options.spotifyTrackId,
    title: options.title,
    artist: options.artist,
    album: options.album,
    durationMs: options.durationMs,
    source: "local_import",
    sourceLabel: "Local import",
    kind: parsedLyrics.kind,
    language: null,
    fetchedAt: new Date().toISOString(),
    providerTrackId: null,
    lines: parsedLyrics.lines,
    plainLyrics: parsedLyrics.plainLyrics
  };

  await writeLyricsCacheFile(cacheFile);
  return cacheFile;
}
