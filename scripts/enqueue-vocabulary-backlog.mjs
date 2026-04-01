import { createClient } from "@supabase/supabase-js";

const PAGE_SIZE = 500;

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

function splitArtistCredits(artist) {
  if (!artist) {
    return [];
  }

  return artist
    .split(/\s*(?:,|&|\band\b|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bx\b)\s*/i)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((name) => ({ name, key: normalizeKey(name) }))
    .filter((entry) => entry.key);
}

function normalizeKey(value) {
  if (!value) {
    return null;
  }

  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : null;
}

function uniqStrings(values) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean)));
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    limit: null,
    artist: null
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      const raw = Number.parseInt(arg.slice("--limit=".length), 10);
      options.limit = Number.isFinite(raw) && raw > 0 ? raw : null;
      continue;
    }

    if (arg.startsWith("--artist=")) {
      options.artist = arg.slice("--artist=".length).trim().toLowerCase() || null;
    }
  }

  return options;
}

async function fetchAllRows(fetchPage) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const page = await fetchPage(from, to);

    if (!Array.isArray(page) || page.length === 0) {
      break;
    }

    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return rows;
}

function buildVocabularyAgentJobKey(spotifyTrackId, generatedAt) {
  return ["vocabulary_agent", spotifyTrackId, generatedAt].join("::");
}

function buildVocabularyPayload(draft, songNodeId, fallbackTrackId, fallbackGeneratedAt) {
  const artist = asString(draft.artist);
  const artistKeys = uniqStrings(splitArtistCredits(artist).map((credit) => credit.key));

  return {
    spotifyTrackId: asString(draft.spotifyTrackId) ?? fallbackTrackId,
    songNodeId,
    title: asString(draft.title),
    artist,
    artistKeys,
    sourceLanguage: asString(draft.sourceLanguage),
    targetLanguage: asString(draft.targetLanguage),
    lineCount: Array.isArray(draft.lines) ? draft.lines.length : 0,
    generatedAt: asString(draft.generatedAt) ?? fallbackGeneratedAt,
    generatorModel: asString(draft?.generator?.model)
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl) {
    throw new Error("Missing required env var: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const [draftRows, worldRows, existingJobRows] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("translation_drafts")
        .select("spotify_track_id, draft_json, updated_at")
        .order("updated_at", { ascending: false })
        .range(from, to)
        .then(({ data, error }) => {
          if (error) {
            throw error;
          }

          return data ?? [];
        })
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("song_world_models")
        .select("spotify_track_id, song_node_id")
        .range(from, to)
        .then(({ data, error }) => {
          if (error) {
            throw error;
          }

          return data ?? [];
        })
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("agent_jobs")
        .select("job_key")
        .eq("job_type", "vocabulary_agent")
        .range(from, to)
        .then(({ data, error }) => {
          if (error) {
            throw error;
          }

          return data ?? [];
        })
    )
  ]);

  const worldModelByTrackId = new Map(
    worldRows
      .map((row) => [asString(row.spotify_track_id), asString(row.song_node_id)])
      .filter(([trackId, songNodeId]) => Boolean(trackId && songNodeId))
  );
  const existingJobKeys = new Set(
    existingJobRows
      .map((row) => asString(row.job_key))
      .filter(Boolean)
  );

  const candidates = [];
  let skippedMissingDraft = 0;
  let skippedMissingWorldModel = 0;
  let skippedExisting = 0;
  let skippedArtistFilter = 0;

  for (const row of draftRows) {
    const draft = isRecord(row.draft_json) ? row.draft_json : null;

    if (!draft) {
      skippedMissingDraft += 1;
      continue;
    }

    const spotifyTrackId = asString(draft.spotifyTrackId) ?? asString(row.spotify_track_id);
    const generatedAt = asString(draft.generatedAt) ?? asString(row.updated_at);
    const artist = asString(draft.artist);

    if (!spotifyTrackId || !generatedAt) {
      skippedMissingDraft += 1;
      continue;
    }

    if (options.artist) {
      const haystack = [artist, draft.artistMemory?.artistKey]
        .map((value) => asString(value)?.toLowerCase())
        .filter(Boolean)
        .join(" ");

      if (!haystack.includes(options.artist)) {
        skippedArtistFilter += 1;
        continue;
      }
    }

    const songNodeId = worldModelByTrackId.get(spotifyTrackId);

    if (!songNodeId) {
      skippedMissingWorldModel += 1;
      continue;
    }

    const jobKey = buildVocabularyAgentJobKey(spotifyTrackId, generatedAt);

    if (existingJobKeys.has(jobKey)) {
      skippedExisting += 1;
      continue;
    }

    candidates.push({
      job_key: jobKey,
      job_type: "vocabulary_agent",
      status: "pending",
      scope_type: "song",
      scope_key: spotifyTrackId,
      spotify_track_id: spotifyTrackId,
      priority: 60,
      payload_json: buildVocabularyPayload(draft, songNodeId, spotifyTrackId, generatedAt)
    });

    if (options.limit && candidates.length >= options.limit) {
      break;
    }
  }

  let enqueued = 0;

  if (!options.dryRun && candidates.length > 0) {
    for (let index = 0; index < candidates.length; index += 100) {
      const chunk = candidates.slice(index, index + 100);
      const { data, error } = await supabase
        .from("agent_jobs")
        .upsert(chunk, { onConflict: "job_key", ignoreDuplicates: true })
        .select("job_key");

      if (error) {
        throw error;
      }

      enqueued += Array.isArray(data) ? data.length : 0;
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun: options.dryRun,
        limit: options.limit,
        artistFilter: options.artist,
        candidatesFound: candidates.length,
        enqueued,
        skippedMissingDraft,
        skippedMissingWorldModel,
        skippedExisting,
        skippedArtistFilter,
        sampleJobKeys: candidates.slice(0, 5).map((job) => job.job_key)
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[vocabulary-backlog] failed.", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
