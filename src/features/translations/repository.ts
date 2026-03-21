import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TrackTranslation, TranslationLine, TranslationStubFile } from "@/features/translations/types";

const translationsRoot = path.join(process.cwd(), "data", "translations");
const translationSearchDirectories = [
  path.join(translationsRoot, "local"),
  path.join(translationsRoot, "samples")
];
const TRANSLATION_STUB_SENTINEL = "__LAFZ_TRANSLATION_STUB__";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isTranslationStubFile(value: unknown): value is TranslationStubFile {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.spotify_track_id === "string" &&
    (typeof value.language === "string" || value.language === null) &&
    Array.isArray(value.lines)
  );
}

function parseTranslationLine(value: unknown, index: number): TranslationLine {
  if (!isRecord(value)) {
    throw new Error(`Invalid line at index ${index}: expected an object.`);
  }

  const { startMs, endMs, original, translated, transliteration, note } = value;

  if (typeof startMs !== "number" || typeof endMs !== "number") {
    throw new Error(`Invalid timing at line ${index}: startMs and endMs must be numbers.`);
  }

  if (typeof original !== "string" || typeof translated !== "string") {
    throw new Error(`Invalid text at line ${index}: original and translated are required strings.`);
  }

  return {
    startMs,
    endMs,
    original,
    translated,
    transliteration: asOptionalString(transliteration),
    note: asOptionalString(note)
  };
}

function parseTrackTranslation(value: unknown, filePath: string): TrackTranslation {
  if (!isRecord(value)) {
    throw new Error(`Invalid translation file at ${filePath}: expected a JSON object.`);
  }

  if (isTranslationStubFile(value)) {
    if (value.lines.length === 0) {
      throw new Error(TRANSLATION_STUB_SENTINEL);
    }

    throw new Error(
      `Translation stub at ${filePath} has line content but is still in the stub format. Replace it with the full Lafz translation JSON shape.`
    );
  }

  const { spotifyTrackId, title, artist, sourceLanguage, targetLanguage, lines } = value;

  if (
    typeof spotifyTrackId !== "string" ||
    typeof title !== "string" ||
    typeof artist !== "string" ||
    typeof sourceLanguage !== "string" ||
    typeof targetLanguage !== "string" ||
    !Array.isArray(lines)
  ) {
    throw new Error(`Invalid translation file at ${filePath}: missing required top-level fields.`);
  }

  return {
    spotifyTrackId,
    title,
    artist,
    sourceLanguage,
    targetLanguage,
    // Parse local JSON carefully so broken files fail loudly during setup instead of silently desyncing at runtime.
    lines: lines
      .map((line, index) => parseTranslationLine(line, index))
      .sort((left, right) => left.startMs - right.startMs)
  };
}

export function getTranslationFileHint(trackId: string) {
  return `data/translations/local/${trackId}.json`;
}

export async function writeTrackTranslationFile(translation: TrackTranslation) {
  const localTranslationsDirectory = path.join(translationsRoot, "local");
  const filePath = path.join(localTranslationsDirectory, `${translation.spotifyTrackId}.json`);
  await mkdir(localTranslationsDirectory, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(translation, null, 2)}\n`, "utf8");
  return filePath;
}

export async function getTranslationByTrackId(trackId: string) {
  for (const directory of translationSearchDirectories) {
    const filePath = path.join(directory, `${trackId}.json`);

    try {
      const fileContents = await readFile(filePath, "utf8");
      const parsed = JSON.parse(fileContents) as unknown;

      return parseTrackTranslation(parsed, filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }

      if (error instanceof Error && error.message === TRANSLATION_STUB_SENTINEL) {
        return null;
      }

      throw error;
    }
  }

  return null;
}
