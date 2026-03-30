import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const artistProfilesRoot = path.join(root, "data", "ai", "memory", "artists");
const draftRoot = path.join(root, "data", "translations", "drafts");
const publishedTranslationsRoot = path.join(root, "data", "translations", "local");

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function listJsonFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => path.join(dir, entry.name));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function backfillArtistProfiles(supabase) {
  const files = await listJsonFiles(artistProfilesRoot);
  let successCount = 0;
  let skippedCount = 0;

  for (const filePath of files) {
    try {
      const parsed = await readJsonFile(filePath);
      const artistKey = asString(parsed.artistKey) ?? path.basename(filePath, ".json");
      const updatedAt = asString(parsed.updatedAt) ?? new Date().toISOString();

      const { error } = await supabase.from("artist_profiles").upsert(
        {
          artist_key: artistKey,
          profile_json: {
            ...(isRecord(parsed) ? parsed : {}),
            artistKey
          },
          updated_at: updatedAt
        },
        { onConflict: "artist_key" }
      );

      if (error) {
        console.error(`Artist profile failed: ${artistKey}`, error.message);
        skippedCount += 1;
        continue;
      }

      successCount += 1;
    } catch (error) {
      console.error(`Artist profile parse failed: ${filePath}`, error instanceof Error ? error.message : String(error));
      skippedCount += 1;
    }
  }

  return {
    total: files.length,
    successCount,
    skippedCount
  };
}

async function backfillDrafts(supabase) {
  const files = await listJsonFiles(draftRoot);
  let successCount = 0;
  let skippedCount = 0;

  for (const filePath of files) {
    try {
      const parsed = await readJsonFile(filePath);

      if (!isRecord(parsed)) {
        skippedCount += 1;
        continue;
      }

      const spotifyTrackId = asString(parsed.spotifyTrackId);
      const sourceLanguage = asString(parsed.sourceLanguage);
      const targetLanguage = asString(parsed.targetLanguage) ?? "English";
      const updatedAt = asString(parsed.generatedAt) ?? new Date().toISOString();

      if (!spotifyTrackId) {
        console.error(`Draft missing spotifyTrackId: ${filePath}`);
        skippedCount += 1;
        continue;
      }

      const { error } = await supabase.from("translation_drafts").upsert(
        {
          spotify_track_id: spotifyTrackId,
          source_language: sourceLanguage,
          target_language: targetLanguage,
          draft_json: parsed,
          updated_at: updatedAt
        },
        { onConflict: "spotify_track_id" }
      );

      if (error) {
        console.error(`Draft failed: ${spotifyTrackId}`, error.message);
        skippedCount += 1;
        continue;
      }

      successCount += 1;
    } catch (error) {
      console.error(`Draft parse failed: ${filePath}`, error instanceof Error ? error.message : String(error));
      skippedCount += 1;
    }
  }

  return {
    total: files.length,
    successCount,
    skippedCount
  };
}

async function backfillPublishedTranslations(supabase) {
  const files = await listJsonFiles(publishedTranslationsRoot);
  let successCount = 0;
  let skippedCount = 0;

  for (const filePath of files) {
    try {
      const parsed = await readJsonFile(filePath);

      if (!isRecord(parsed)) {
        skippedCount += 1;
        continue;
      }

      const spotifyTrackId = asString(parsed.spotifyTrackId);
      const lines = Array.isArray(parsed.lines) ? parsed.lines : [];
      const updatedAt = new Date().toISOString();

      if (!spotifyTrackId || lines.length === 0) {
        skippedCount += 1;
        continue;
      }

      const { error } = await supabase.from("published_translations").upsert(
        {
          spotify_track_id: spotifyTrackId,
          translation_json: parsed,
          is_synced: true,
          updated_at: updatedAt
        },
        { onConflict: "spotify_track_id" }
      );

      if (error) {
        console.error(`Published translation failed: ${spotifyTrackId}`, error.message);
        skippedCount += 1;
        continue;
      }

      successCount += 1;
    } catch (error) {
      console.error(`Published translation parse failed: ${filePath}`, error instanceof Error ? error.message : String(error));
      skippedCount += 1;
    }
  }

  return {
    total: files.length,
    successCount,
    skippedCount
  };
}

async function main() {
  const supabaseUrl = requiredEnv("SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  console.log("Starting Supabase backfill...");

  const [artistProfiles, drafts, publishedTranslations] = await Promise.all([
    backfillArtistProfiles(supabase),
    backfillDrafts(supabase),
    backfillPublishedTranslations(supabase)
  ]);

  console.log("");
  console.log("Backfill complete.");
  console.log(
    JSON.stringify(
      {
        artistProfiles,
        drafts,
        publishedTranslations
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
