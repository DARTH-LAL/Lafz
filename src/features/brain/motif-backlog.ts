import { getSupabaseServerClient } from "@/features/cloud/supabase";
import { splitArtistCredits, uniqStrings } from "@/features/brain/normalize";

const DEFAULT_BACKLOG_BATCH_SIZE = 5;
const DEFAULT_BACKLOG_REFILL_COOLDOWN_MS = 60_000;
const BACKLOG_SCAN_PAGE_SIZE = 500;
const MOTIF_AGENT_JOB_VERSION = "v2";

type UnknownRecord = Record<string, unknown>;

type EnqueueMotifBacklogBatchOptions = {
  limit?: number;
};

type MotifBacklogBatchResult = {
  candidatesFound: number;
  enqueued: number;
  exhausted: boolean;
  sampleJobKeys: string[];
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getBacklogBatchSize() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_BACKLOG_BATCH_SIZE ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BACKLOG_BATCH_SIZE;
}

export function getMotifBacklogRefillCooldownMs() {
  const raw = Number.parseInt(process.env.LAFZ_AGENT_BACKLOG_REFILL_COOLDOWN_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_BACKLOG_REFILL_COOLDOWN_MS;
}

export function isMotifBacklogAutoRefillEnabled() {
  const value = process.env.LAFZ_AGENT_AUTO_BACKLOG_ENABLED?.trim().toLowerCase();

  if (value === "false" || value === "0" || value === "off") {
    return false;
  }

  return true;
}

function buildMotifAgentJobKey(spotifyTrackId: string, generatedAt: string) {
  return ["motif_agent", MOTIF_AGENT_JOB_VERSION, spotifyTrackId, generatedAt].join("::");
}

function buildMotifPayload(draft: UnknownRecord, songNodeId: string, fallbackTrackId: string, fallbackGeneratedAt: string) {
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
    generatorModel:
      isRecord(draft.generator) && asString(draft.generator.model)
        ? asString(draft.generator.model)
        : null
  };
}

async function fetchPagedRows(fetchPage: (from: number, to: number) => Promise<unknown[]>) {
  const rows: unknown[] = [];
  let from = 0;

  while (true) {
    const to = from + BACKLOG_SCAN_PAGE_SIZE - 1;
    const page = await fetchPage(from, to);

    if (!Array.isArray(page) || page.length === 0) {
      break;
    }

    rows.push(...page);

    if (page.length < BACKLOG_SCAN_PAGE_SIZE) {
      break;
    }

    from += BACKLOG_SCAN_PAGE_SIZE;
  }

  return rows;
}

export async function hasActiveMotifAgentJobs() {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return false;
  }

  const { count, error } = await supabase
    .from("agent_jobs")
    .select("*", { count: "exact", head: true })
    .eq("job_type", "motif_agent")
    .in("status", ["pending", "claimed", "running"]);

  if (error) {
    console.error("[lafz-brain] could not count active motif jobs.", error);
    return false;
  }

  return (count ?? 0) > 0;
}

export async function enqueueMotifBacklogBatch(
  options: EnqueueMotifBacklogBatchOptions = {}
): Promise<MotifBacklogBatchResult> {
  const supabase = getSupabaseServerClient();

  if (!supabase) {
    return {
      candidatesFound: 0,
      enqueued: 0,
      exhausted: true,
      sampleJobKeys: []
    };
  }

  const limit = Math.max(1, options.limit ?? getBacklogBatchSize());

  const [draftRows, worldRows, existingJobRows] = await Promise.all([
    fetchPagedRows(async (from, to) => {
      const { data, error } = await supabase
        .from("translation_drafts")
        .select("spotify_track_id, draft_json, updated_at")
        .order("updated_at", { ascending: true })
        .range(from, to);

      if (error) {
        throw error;
      }

      return data ?? [];
    }),
    fetchPagedRows(async (from, to) => {
      const { data, error } = await supabase
        .from("song_world_models")
        .select("spotify_track_id, song_node_id")
        .range(from, to);

      if (error) {
        throw error;
      }

      return data ?? [];
    }),
    fetchPagedRows(async (from, to) => {
      const { data, error } = await supabase
        .from("agent_jobs")
        .select("job_key")
        .eq("job_type", "motif_agent")
        .range(from, to);

      if (error) {
        throw error;
      }

      return data ?? [];
    })
  ]).catch((error) => {
    console.error("[lafz-brain] could not scan motif backlog.", error);
    return [[], [], []] as const;
  });

  const worldModelByTrackId = new Map(
    worldRows
      .map((row) => {
        if (!isRecord(row)) {
          return null;
        }

        return [asString(row.spotify_track_id), asString(row.song_node_id)] as const;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry?.[0] && entry?.[1]))
  );

  const existingJobKeys = new Set(
    existingJobRows
      .map((row) => (isRecord(row) ? asString(row.job_key) : null))
      .filter((value): value is string => Boolean(value))
  );

  const candidates: Array<Record<string, unknown>> = [];
  let exhausted = true;

  for (const row of draftRows) {
    if (!isRecord(row)) {
      continue;
    }

    const draft = isRecord(row.draft_json) ? row.draft_json : null;

    if (!draft) {
      continue;
    }

    const spotifyTrackId = asString(draft.spotifyTrackId) ?? asString(row.spotify_track_id);
    const generatedAt = asString(draft.generatedAt) ?? asString(row.updated_at);

    if (!spotifyTrackId || !generatedAt) {
      continue;
    }

    const songNodeId = worldModelByTrackId.get(spotifyTrackId);

    if (!songNodeId) {
      continue;
    }

    const jobKey = buildMotifAgentJobKey(spotifyTrackId, generatedAt);

    if (existingJobKeys.has(jobKey)) {
      continue;
    }

    exhausted = false;
    candidates.push({
      job_key: jobKey,
      job_type: "motif_agent",
      status: "pending",
      scope_type: "song",
      scope_key: spotifyTrackId,
      spotify_track_id: spotifyTrackId,
      priority: 172,
      payload_json: buildMotifPayload(draft, songNodeId, spotifyTrackId, generatedAt)
    });

    if (candidates.length >= limit) {
      break;
    }
  }

  if (candidates.length === 0) {
    return {
      candidatesFound: 0,
      enqueued: 0,
      exhausted,
      sampleJobKeys: []
    };
  }

  const { data, error } = await supabase
    .from("agent_jobs")
    .insert(candidates)
    .select("job_key");

  if (error) {
    console.error("[lafz-brain] could not enqueue motif backlog jobs.", error);
    return {
      candidatesFound: candidates.length,
      enqueued: 0,
      exhausted,
      sampleJobKeys: []
    };
  }

  return {
    candidatesFound: candidates.length,
    enqueued: data?.length ?? 0,
    exhausted,
    sampleJobKeys: (data ?? [])
      .map((row) => (isRecord(row) ? asString(row.job_key) : null))
      .filter((value): value is string => Boolean(value))
      .slice(0, 5)
  };
}
