import { listCloudDataKeys, readCloudDataJson, writeCloudDataJson, toCloudDataHint } from "@/features/cloud/data-store";
import { getSupabaseServerClient } from "@/features/cloud/supabase";
import type { TrackTranslation, TranslationLine, TranslationStubFile } from "@/features/translations/types";

const translationSearchDirectories = [
  "data/translations/local",
  "data/translations/samples"
];
const TRANSLATION_STUB_SENTINEL = "__LAFZ_TRANSLATION_STUB__";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asOptionalString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeLookupText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeArtistTokens(value: string) {
  return value
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/gi)
    .map((entry) => normalizeLookupText(entry))
    .filter(Boolean);
}

function scoreTranslationMetadataMatch(
  translation: TrackTranslation,
  target: {
    title: string;
    artist: string;
  }
) {
  const normalizedTitle = normalizeLookupText(target.title);
  const normalizedArtist = normalizeLookupText(target.artist);

  if (!normalizedTitle || normalizeLookupText(translation.title) !== normalizedTitle) {
    return null;
  }

  const translationArtist = normalizeLookupText(translation.artist);

  if (translationArtist === normalizedArtist) {
    return 100;
  }

  const targetTokens = new Set(normalizeArtistTokens(target.artist));
  const overlap = normalizeArtistTokens(translation.artist).filter((token) => targetTokens.has(token)).length;

  if (overlap === 0) {
    return null;
  }

  return overlap * 10;
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

async function readTrackTranslationFromSupabase(trackId: string) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("published_translations")
    .select("spotify_track_id, translation_json")
    .eq("spotify_track_id", trackId)
    .maybeSingle();

  if (error) {
    console.error(`Could not read published translation ${trackId} from Supabase.`, error);
    return null;
  }

  if (!data) {
    return null;
  }

  try {
    return parseTrackTranslation(data.translation_json, `supabase:published_translations/${trackId}`);
  } catch (error) {
    if (error instanceof Error && error.message === TRANSLATION_STUB_SENTINEL) {
      return null;
    }

    console.error(`Supabase published translation ${trackId} could not be parsed.`, error);
    return null;
  }
}

async function writeTrackTranslationToSupabase(translation: TrackTranslation) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return;
  }

  const { error } = await supabase.from("published_translations").upsert(
    {
      spotify_track_id: translation.spotifyTrackId,
      translation_json: translation,
      is_synced: true,
      updated_at: new Date().toISOString()
    },
    {
      onConflict: "spotify_track_id"
    }
  );

  if (error) {
    console.error(`Could not write published translation ${translation.spotifyTrackId} to Supabase.`, error);
  }
}

async function findTrackTranslationByMetadataFromSupabase(target: { title: string; artist: string }) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.from("published_translations").select("spotify_track_id, translation_json");

  if (error) {
    console.error("Could not search published translations in Supabase.", error);
    return null;
  }

  let bestMatch: {
    score: number;
    translation: TrackTranslation;
  } | null = null;

  for (const row of data ?? []) {
    try {
      const parsed = parseTrackTranslation(row.translation_json, `supabase:published_translations/${row.spotify_track_id}`);
      const score = scoreTranslationMetadataMatch(parsed, target);

      if (score !== null && (!bestMatch || score > bestMatch.score)) {
        bestMatch = {
          score,
          translation: parsed
        };
      }
    } catch (error) {
      if (error instanceof Error && error.message === TRANSLATION_STUB_SENTINEL) {
        continue;
      }
    }
  }

  return bestMatch?.translation ?? null;
}

export function getTranslationFileHint(trackId: string) {
  return toCloudDataHint(`data/translations/local/${trackId}.json`);
}

export async function writeTrackTranslationFile(translation: TrackTranslation) {
  const filePath = `data/translations/local/${translation.spotifyTrackId}.json`;
  await writeCloudDataJson(filePath, translation);
  await writeTrackTranslationToSupabase(translation);
  return toCloudDataHint(filePath);
}

export async function getTranslationByTrackId(trackId: string) {
  const cloudTranslation = await readTrackTranslationFromSupabase(trackId);

  if (cloudTranslation) {
    return cloudTranslation;
  }

  for (const directory of translationSearchDirectories) {
    const filePath = `${directory}/${trackId}.json`;

    try {
      const parsed = await readCloudDataJson<unknown>(filePath);

      if (!parsed) {
        continue;
      }

      return parseTrackTranslation(parsed, filePath);
    } catch (error) {
      if (error instanceof Error && error.message === TRANSLATION_STUB_SENTINEL) {
        return null;
      }

      throw error;
    }
  }

  return null;
}

export async function findTranslationByMetadata(target: { title: string; artist: string }) {
  const cloudMatch = await findTrackTranslationByMetadataFromSupabase(target);

  if (cloudMatch) {
    return cloudMatch;
  }

  let bestMatch: {
    score: number;
    translation: TrackTranslation;
  } | null = null;

  for (const directory of translationSearchDirectories) {
    const fileKeys = await listCloudDataKeys(directory);

    for (const filePath of fileKeys.filter((key) => key.endsWith(".json"))) {

      try {
        const rawFile = await readCloudDataJson<unknown>(filePath);
        if (!rawFile) {
          continue;
        }

        const parsed = parseTrackTranslation(rawFile, filePath);
        const score = scoreTranslationMetadataMatch(parsed, target);

        if (score !== null && (!bestMatch || score > bestMatch.score)) {
          bestMatch = {
            score,
            translation: parsed
          };
        }
      } catch (error) {
        if (error instanceof Error && error.message === TRANSLATION_STUB_SENTINEL) {
          continue;
        }

        throw error;
      }
    }
  }

  return bestMatch?.translation ?? null;
}
