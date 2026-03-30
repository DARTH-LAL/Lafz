import { getCloudDataMetadata, isCloudStorageConfigurationError, listCloudDataObjects, readCloudDataJson, toCloudDataHint } from "@/features/cloud/data-store";
import { getSupabaseServerClient } from "@/features/cloud/supabase";
import { getLocalTranslationFilePath } from "@/features/translations/stubs";
import type { TranslationFileInspection } from "@/features/translations/types";

const LOCAL_TRANSLATIONS_DIR = "data/translations/local";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getLineCount(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.lines)) {
    return 0;
  }

  return value.lines.length;
}

function deriveLanguage(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  return asString(value.sourceLanguage) ?? asString(value.language);
}

function buildTranslationInspection(
  spotifyTrackId: string,
  parsedJson: unknown,
  options?: {
    filePath?: string;
    lastModifiedAt?: string | null;
  }
): TranslationFileInspection {
  const filePath = options?.filePath ?? toCloudDataHint(getLocalTranslationFilePath(spotifyTrackId));
  const lineCount = getLineCount(parsedJson);

  return {
    exists: true,
    filePath,
    kind: lineCount > 0 ? "translated" : "stub",
    lineCount,
    lastModifiedAt: options?.lastModifiedAt ?? null,
    language: deriveLanguage(parsedJson),
    preview: JSON.stringify(parsedJson, null, 2),
    parsedJson,
    parseError: null
  };
}

async function readTranslationInspectionFromSupabase(spotifyTrackId: string): Promise<TranslationFileInspection | null> {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("published_translations")
    .select("spotify_track_id, translation_json, updated_at")
    .eq("spotify_track_id", spotifyTrackId)
    .maybeSingle();

  if (error) {
    console.error(`Could not inspect published translation ${spotifyTrackId} from Supabase.`, error);
    return null;
  }

  if (!data) {
    return null;
  }

  return buildTranslationInspection(spotifyTrackId, data.translation_json, {
    filePath: `supabase:published_translations/${spotifyTrackId}`,
    lastModifiedAt: asString(data.updated_at)
  });
}

function chunkTrackIds(trackIds: string[], size = 200) {
  const chunks: string[][] = [];

  for (let index = 0; index < trackIds.length; index += size) {
    chunks.push(trackIds.slice(index, index + size));
  }

  return chunks;
}

export async function batchInspectTranslationFiles(trackIds: Iterable<string>): Promise<Map<string, TranslationFileInspection>> {
  const uniqueTrackIds = [...new Set([...trackIds].filter(Boolean))];
  const inspections = new Map<string, TranslationFileInspection>();

  if (uniqueTrackIds.length === 0) {
    return inspections;
  }

  const supabase = getSupabaseServerClient();

  if (supabase) {
    for (const chunk of chunkTrackIds(uniqueTrackIds)) {
      const { data, error } = await supabase
        .from("published_translations")
        .select("spotify_track_id, translation_json, updated_at")
        .in("spotify_track_id", chunk);

      if (error) {
        console.error("Could not batch inspect published translations from Supabase.", error);
        break;
      }

      for (const row of data ?? []) {
        inspections.set(
          row.spotify_track_id,
          buildTranslationInspection(row.spotify_track_id, row.translation_json, {
            filePath: `supabase:published_translations/${row.spotify_track_id}`,
            lastModifiedAt: asString(row.updated_at)
          })
        );
      }
    }
  }

  const unresolvedTrackIds = uniqueTrackIds.filter((trackId) => !inspections.has(trackId));

  if (unresolvedTrackIds.length === 0) {
    return inspections;
  }

  const localObjects = await listCloudDataObjects(LOCAL_TRANSLATIONS_DIR);
  const objectByTrackId = new Map(
    localObjects
      .filter((item) => item.key.endsWith(".json"))
      .map((item) => [item.key.split("/").pop()?.replace(/\.json$/i, "") ?? "", item] as const)
  );

  await Promise.all(
    unresolvedTrackIds.map(async (trackId) => {
      const object = objectByTrackId.get(trackId);

      if (!object) {
        return;
      }

      try {
        const parsedJson = await readCloudDataJson<unknown>(object.key);

        if (!parsedJson) {
          return;
        }

        inspections.set(
          trackId,
          buildTranslationInspection(trackId, parsedJson, {
            filePath: toCloudDataHint(object.key),
            lastModifiedAt: object.lastModifiedAt
          })
        );
      } catch (error) {
        if (isCloudStorageConfigurationError(error)) {
          throw error;
        }

        inspections.set(trackId, {
          exists: true,
          filePath: toCloudDataHint(getLocalTranslationFilePath(trackId)),
          kind: "malformed",
          lineCount: 0,
          lastModifiedAt: object.lastModifiedAt,
          language: null,
          preview: null,
          parsedJson: null,
          parseError: error instanceof Error ? error.message : "Could not parse translation JSON."
        });
      }
    })
  );

  return inspections;
}

export async function inspectTranslationFile(spotifyTrackId: string): Promise<TranslationFileInspection> {
  const filePath = getLocalTranslationFilePath(spotifyTrackId);

  try {
    const supabaseInspection = await readTranslationInspectionFromSupabase(spotifyTrackId);

    if (supabaseInspection) {
      return supabaseInspection;
    }

    const [parsedJson, fileMeta] = await Promise.all([
      readCloudDataJson<unknown>(filePath),
      getCloudDataMetadata(filePath)
    ]);

    if (!parsedJson) {
      return {
        exists: false,
        filePath: toCloudDataHint(filePath),
        kind: "missing",
        lineCount: 0,
        lastModifiedAt: null,
        language: null,
        preview: null,
        parsedJson: null,
        parseError: null
      };
    }

    try {
      return buildTranslationInspection(spotifyTrackId, parsedJson, {
        filePath: toCloudDataHint(filePath),
        lastModifiedAt: fileMeta?.lastModifiedAt ?? null
      });
    } catch (error) {
      return {
        exists: true,
        filePath: toCloudDataHint(filePath),
        kind: "malformed",
        lineCount: 0,
        lastModifiedAt: fileMeta?.lastModifiedAt ?? null,
        language: null,
        preview: JSON.stringify(parsedJson, null, 2),
        parsedJson: null,
        parseError: error instanceof Error ? error.message : "Could not parse translation JSON."
      };
    }
  } catch (error) {
    if (isCloudStorageConfigurationError(error)) {
      throw error;
    }

    return {
      exists: true,
      filePath: toCloudDataHint(filePath),
      kind: "malformed",
      lineCount: 0,
      lastModifiedAt: null,
      language: null,
      preview: null,
      parsedJson: null,
      parseError: error instanceof Error ? error.message : "Could not parse translation JSON."
    };
  }
}
