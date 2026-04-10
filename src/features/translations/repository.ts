import { listCloudDataKeys, readCloudDataJson, writeCloudDataJson, toCloudDataHint } from "@/features/cloud/data-store";
import { getSupabaseServerClient } from "@/features/cloud/supabase";
import { findLibraryTrackArtworkUrlByMetadata, findLibraryTrackArtworkUrlByTrackId } from "@/features/library/track-art";
import { formatTranslationNote, sanitizeTranslationNotes } from "@/features/translations/note-format";
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

function asOptionalStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
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

function normalizeLooseTitle(value: string) {
  return normalizeLookupText(
    value
      .replace(/^\(\s*\d+\s*\)\s*/, "")
      .replace(/\((?:[^()]|\([^()]*\))*\)/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\s(?:[-–—]|[|•·:])\s.*$/, " ")
      .replace(/\b(?:feat|ft|featuring)\b.*$/i, " ")
  );
}

function normalizeArtistTokens(value: string | null | undefined) {
  return String(value ?? "")
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/gi)
    .map((entry) => normalizeLookupText(entry))
    .filter(Boolean);
}

function scoreTitleMatch(targetTitle: string, translationTitle: string) {
  const normalizedTargetTitle = normalizeLookupText(targetTitle);
  const normalizedTranslationTitle = normalizeLookupText(translationTitle);

  if (!normalizedTargetTitle || !normalizedTranslationTitle) {
    return null;
  }

  if (normalizedTargetTitle === normalizedTranslationTitle) {
    return 100;
  }

  const looseTargetTitle = normalizeLooseTitle(targetTitle);
  const looseTranslationTitle = normalizeLooseTitle(translationTitle);

  if (!looseTargetTitle || !looseTranslationTitle) {
    return null;
  }

  if (looseTargetTitle === looseTranslationTitle) {
    return 92;
  }

  if (looseTargetTitle.includes(looseTranslationTitle) || looseTranslationTitle.includes(looseTargetTitle)) {
    const shorterLength = Math.min(looseTargetTitle.length, looseTranslationTitle.length);
    const longerLength = Math.max(looseTargetTitle.length, looseTranslationTitle.length);
    const overlapRatio = longerLength > 0 ? shorterLength / longerLength : 0;

    if (overlapRatio >= 0.8) {
      return 88;
    }

    if (overlapRatio >= 0.65) {
      return 82;
    }

    return 74;
  }

  return null;
}

function scoreBestTitleMatch(targetTitle: string, translationTitles: Array<string | null | undefined>) {
  let bestScore: number | null = null;

  for (const translationTitle of translationTitles) {
    if (typeof translationTitle !== "string" || !translationTitle.trim()) {
      continue;
    }

    const score = scoreTitleMatch(targetTitle, translationTitle);
    if (score !== null && (bestScore === null || score > bestScore)) {
      bestScore = score;
    }
  }

  return bestScore;
}

function scoreTranslationMetadataMatch(
  translation: TrackTranslation,
  target: {
    title: string;
    artist?: string | null;
  },
  identity?: {
    canonicalTitle?: string | null;
    canonicalArtist?: string | null;
    alternateTitles?: string[] | null;
    matchConfidence?: number | null;
  }
) {
  const confidenceBonus = Number.isFinite(identity?.matchConfidence ?? NaN)
    ? Math.max(0, Math.min(5, Math.round((identity?.matchConfidence ?? 1) * 2)))
    : 0;
  const titleCandidates = [
    translation.title,
    identity?.canonicalTitle ?? null,
    ...(identity?.alternateTitles ?? [])
  ];
  const titleScore = scoreBestTitleMatch(target.title, titleCandidates);

  if (titleScore === null) {
    return null;
  }

  const normalizedArtist = normalizeLookupText(target.artist ?? "");
  const artistCandidates = [translation.artist, identity?.canonicalArtist ?? null];
  const normalizedArtistCandidates = artistCandidates
    .filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0)
    .map((candidate) => normalizeLookupText(candidate));

  if (!normalizedArtist) {
    return titleScore + confidenceBonus;
  }

  if (normalizedArtistCandidates.some((candidate) => candidate === normalizedArtist)) {
    return titleScore + 20 + confidenceBonus;
  }

  const targetTokens = new Set(normalizeArtistTokens(target.artist));
  const overlap = artistCandidates
    .filter((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0)
    .flatMap((candidate) => normalizeArtistTokens(candidate))
    .filter((token) => targetTokens.has(token)).length;

  if (overlap === 0) {
    return null;
  }

  return titleScore + overlap * 10 + confidenceBonus;
}

function isMissingPublishedTranslationIdentityColumnsError(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  const normalized = detail.toLowerCase();

  return [
    "canonical_title",
    "canonical_artist",
    "alternate_titles",
    "source_host",
    "match_confidence"
  ].some((column) => normalized.includes(column));
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
    note: formatTranslationNote(asOptionalString(note)) ?? undefined
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

  const sanitizedTranslation = sanitizeTranslationNotes(translation);
  const albumArtUrl =
    await findLibraryTrackArtworkUrlByTrackId(sanitizedTranslation.spotifyTrackId).catch(() => null) ??
    await findLibraryTrackArtworkUrlByMetadata({
      title: sanitizedTranslation.title,
      artist: sanitizedTranslation.artist,
      album: (sanitizedTranslation as { album?: string | null }).album ?? null
    }).catch(() => null);
  const canonicalTitle = sanitizedTranslation.title.trim();
  const canonicalArtist = sanitizedTranslation.artist.trim();
  const alternateTitles = [...new Set([
    canonicalTitle,
    normalizeLooseTitle(canonicalTitle)
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0))];
  const matchConfidence = Number.isFinite(translation.matchConfidence ?? null) ? (translation.matchConfidence ?? null) : 1;
  const publishedRow: Record<string, unknown> = {
    spotify_track_id: sanitizedTranslation.spotifyTrackId,
    translation_json: sanitizedTranslation,
    canonical_title: canonicalTitle,
    canonical_artist: canonicalArtist,
    alternate_titles: alternateTitles,
    source_host: translation.sourceHost ?? null,
    match_confidence: matchConfidence ?? 1,
    is_synced: true,
    updated_at: new Date().toISOString()
  };

  if (albumArtUrl) {
    publishedRow.album_art_url = albumArtUrl;
  }

  const { error } = await supabase.from("published_translations").upsert(publishedRow, {
    onConflict: "spotify_track_id"
  });

  if (error) {
    if (isMissingPublishedTranslationIdentityColumnsError(error)) {
      const fallbackRow: Record<string, unknown> = {
        spotify_track_id: translation.spotifyTrackId,
        translation_json: translation,
        is_synced: true,
        updated_at: new Date().toISOString()
      };

      if (albumArtUrl) {
        fallbackRow.album_art_url = albumArtUrl;
      }

      const fallback = await supabase.from("published_translations").upsert(fallbackRow, {
        onConflict: "spotify_track_id"
      });

      if (fallback.error) {
        console.error(`Could not write published translation ${translation.spotifyTrackId} to Supabase.`, fallback.error);
      }

      return;
    }

    console.error(`Could not write published translation ${translation.spotifyTrackId} to Supabase.`, error);
  }
}

async function findTrackTranslationByMetadataFromSupabase(target: { title: string; artist?: string | null }) {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("published_translations")
    .select("spotify_track_id, translation_json, canonical_title, canonical_artist, alternate_titles, match_confidence");

  if (error) {
    if (isMissingPublishedTranslationIdentityColumnsError(error)) {
      const fallbackQuery = await supabase.from("published_translations").select("spotify_track_id, translation_json");

      if (fallbackQuery.error) {
        console.error("Could not search published translations in Supabase.", fallbackQuery.error);
        return null;
      }

      let fallbackBestMatch: {
        score: number;
        translation: TrackTranslation;
      } | null = null;

      for (const row of fallbackQuery.data ?? []) {
        try {
          const parsed = parseTrackTranslation(row.translation_json, `supabase:published_translations/${row.spotify_track_id}`);
          const score = scoreTranslationMetadataMatch(parsed, target);

          if (score !== null && (!fallbackBestMatch || score > fallbackBestMatch.score)) {
            fallbackBestMatch = {
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

      return fallbackBestMatch?.translation ?? null;
    }

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
      const score = scoreTranslationMetadataMatch(parsed, target, {
        canonicalTitle: asOptionalString(row.canonical_title) ?? undefined,
        canonicalArtist: asOptionalString(row.canonical_artist) ?? undefined,
        alternateTitles: asOptionalStringArray(row.alternate_titles) ?? undefined,
        matchConfidence: typeof row.match_confidence === "number" ? row.match_confidence : null
      });

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
  const sanitizedTranslation = sanitizeTranslationNotes(translation);
  const filePath = `data/translations/local/${sanitizedTranslation.spotifyTrackId}.json`;
  await writeCloudDataJson(filePath, sanitizedTranslation);
  await writeTrackTranslationToSupabase(sanitizedTranslation);
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

export async function findTranslationByMetadata(target: { title: string; artist?: string | null }) {
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
