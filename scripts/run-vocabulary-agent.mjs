import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function requiredSupabaseUrl() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();

  if (!value) {
    throw new Error("Missing required env var: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL");
  }

  return value;
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function asString(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.map((entry) => asString(entry)).filter((entry) => Boolean(entry))
    : [];
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

function normalizeLookupText(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function uniqStrings(values) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean)));
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

function buildClaimKey(scopeType, scopeKey, claimType, normalizedKey) {
  return [scopeType, scopeKey, claimType, normalizedKey].join("::");
}

function buildCombinedArtistEntries(memory) {
  if (!isRecord(memory)) {
    return [];
  }

  const glossaryEntries = Array.isArray(memory.glossaryEntries)
    ? memory.glossaryEntries.filter((entry) => isRecord(entry))
    : [];
  const canonicalEntries = Array.isArray(memory.canonicalRenderings)
    ? memory.canonicalRenderings
        .filter((entry) => isRecord(entry))
        .map((entry) => ({
          term: asString(entry.term),
          meaning: asString(entry.rendering),
          note: asString(entry.note),
          aliases: [],
          category: "preferred_rendering"
        }))
        .filter((entry) => entry.term && entry.meaning)
    : [];

  return [...glossaryEntries, ...canonicalEntries];
}

function getMemorySignalScore(memory) {
  if (!isRecord(memory)) {
    return 0;
  }

  const glossaryCount = Array.isArray(memory.glossaryEntries) ? memory.glossaryEntries.length : 0;
  const canonicalCount = Array.isArray(memory.canonicalRenderings) ? memory.canonicalRenderings.length : 0;
  const recurringMotifCount = Array.isArray(memory.recurringMotifs) ? memory.recurringMotifs.length : 0;
  return glossaryCount * 5 + canonicalCount * 6 + recurringMotifCount;
}

function chooseBestArtistMemory(artistKey, profileMemory, fallbackDraftMemory) {
  if (!fallbackDraftMemory) {
    return profileMemory;
  }

  const fallbackArtistKey = normalizeKey(asString(fallbackDraftMemory.artistKey));

  if (fallbackArtistKey !== artistKey) {
    return profileMemory;
  }

  const profileScore = getMemorySignalScore(profileMemory);
  const fallbackScore = getMemorySignalScore(fallbackDraftMemory);

  return fallbackScore > profileScore ? fallbackDraftMemory : profileMemory ?? fallbackDraftMemory;
}

function findMatchingLines(entry, draft) {
  const searchTerms = [entry.term, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]
    .map((value) => asString(value))
    .filter(Boolean)
    .map((value) => normalizeLookupText(value));

  if (searchTerms.length === 0) {
    return [];
  }

  return (Array.isArray(draft.lines) ? draft.lines : []).filter((line) => {
    if (!isRecord(line)) {
      return false;
    }

    const haystacks = [
      asString(line.original),
      asString(line.normalizedOriginal),
      asString(line.meaning),
      asString(line.impliedMeaning)
    ]
      .filter(Boolean)
      .map((value) => normalizeLookupText(value));

    return searchTerms.some((term) => haystacks.some((haystack) => haystack.includes(term)));
  });
}

function decidePromotion(confidenceScore, evidenceCount) {
  if (confidenceScore >= 0.74 && evidenceCount >= 2) {
    return {
      decision: "accepted",
      reason: "Artist term usage is supported by memory plus draft evidence."
    };
  }

  if (confidenceScore < 0.55 && evidenceCount <= 1) {
    return {
      decision: "rejected",
      reason: "Artist term usage is too weak to trust yet."
    };
  }

  return {
    decision: "deferred",
    reason: "Needs repeated usage before promotion."
  };
}

function nextClaimStatus(decision) {
  if (decision === "accepted") {
    return "accepted";
  }

  if (decision === "rejected") {
    return "rejected";
  }

  return "proposed";
}

const supabase = createClient(requiredSupabaseUrl(), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function claimNextVocabularyJob(workerId) {
  const { data, error } = await supabase.rpc("claim_next_agent_job", {
    p_worker_id: workerId,
    p_job_type: "vocabulary_agent"
  });

  if (error) {
    throw error;
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return rows[0] ?? null;
}

async function updateJob(jobId, patch) {
  const payload = {
    updated_at: new Date().toISOString(),
    ...patch
  };

  const { error } = await supabase.from("agent_jobs").update(payload).eq("id", jobId);

  if (error) {
    throw error;
  }
}

async function insertRun(jobId, workerId, input) {
  const { data, error } = await supabase
    .from("agent_runs")
    .insert({
      job_id: jobId,
      agent_role: "vocabulary_agent",
      status: "running",
      worker_id: workerId,
      input_json: input ?? {},
      updated_at: new Date().toISOString()
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data.id;
}

async function updateRun(runId, patch) {
  const { error } = await supabase
    .from("agent_runs")
    .update({
      updated_at: new Date().toISOString(),
      ...patch
    })
    .eq("id", runId);

  if (error) {
    throw error;
  }
}

async function loadDraft(spotifyTrackId) {
  const { data, error } = await supabase
    .from("translation_drafts")
    .select("draft_json")
    .eq("spotify_track_id", spotifyTrackId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return isRecord(data?.draft_json) ? data.draft_json : null;
}

async function loadArtistMemories(artistKeys, fallbackDraftMemory, fallbackArtistName) {
  const keys = uniqStrings(artistKeys);

  if (keys.length === 0) {
    return [];
  }

  const { data, error } = await supabase.from("artist_profiles").select("artist_key, profile_json").in("artist_key", keys);

  if (error) {
    throw error;
  }

  const memoryByKey = new Map(
    (data ?? [])
      .map((row) => {
        const artistKey = asString(row.artist_key);
        const profile = isRecord(row.profile_json) ? row.profile_json : null;

        if (!artistKey || !profile) {
          return null;
        }

        return [artistKey, profile];
      })
      .filter(Boolean)
  );

  return keys.map((artistKey) => {
    const profileMemory = memoryByKey.get(artistKey) ?? null;
    const memory = chooseBestArtistMemory(artistKey, profileMemory, fallbackDraftMemory);
    const displayName =
      asString(memory?.displayName) ??
      splitArtistCredits(fallbackArtistName).find((credit) => credit.key === artistKey)?.name ??
      artistKey;

    return {
      artistKey,
      displayName,
      memory
    };
  });
}

async function upsertClaim(input) {
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await supabase
    .from("kg_claims")
    .select("*")
    .eq("claim_key", input.claimKey)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existing) {
    const nextConfidenceScore = Math.max(Number(existing.confidence_score ?? 0.5), input.confidenceScore);
    const { data, error } = await supabase
      .from("kg_claims")
      .update({
        confidence_score: nextConfidenceScore,
        payload_json: input.payload,
        source_count: Number(existing.source_count ?? 0) + 1,
        last_seen_at: now,
        updated_at: now,
        agent_session_id: input.agentSessionId
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  const { data, error } = await supabase
    .from("kg_claims")
    .insert({
      claim_key: input.claimKey,
      claim_type: input.claimType,
      scope_type: input.scopeType,
      scope_key: input.scopeKey,
      normalized_key: input.normalizedKey,
      status: "proposed",
      confidence_score: input.confidenceScore,
      source_count: 1,
      evidence_count: 0,
      payload_json: input.payload,
      agent_session_id: input.agentSessionId,
      first_seen_at: now,
      last_seen_at: now,
      updated_at: now
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function insertEvidence(claimId, evidence) {
  const { error } = await supabase.from("kg_evidence").insert({
    claim_id: claimId,
    source_type: evidence.sourceType,
    spotify_track_id: evidence.spotifyTrackId ?? null,
    artist_key: evidence.artistKey ?? null,
    line_order: evidence.lineOrder ?? null,
    weight: evidence.weight,
    payload_json: evidence.payload ?? {},
    agent_session_id: evidence.agentSessionId
  });

  if (error) {
    throw error;
  }

  const { data, error: readError } = await supabase.from("kg_claims").select("evidence_count").eq("id", claimId).single();

  if (readError) {
    throw readError;
  }

  const { error: updateError } = await supabase
    .from("kg_claims")
    .update({
      evidence_count: Number(data.evidence_count ?? 0) + 1,
      updated_at: new Date().toISOString()
    })
    .eq("id", claimId);

  if (updateError) {
    throw updateError;
  }
}

async function maybeInsertPromotion(claimId, decision, reason, metadata) {
  const { data: latestRows, error: latestError } = await supabase
    .from("kg_promotions")
    .select("id, decision")
    .eq("claim_id", claimId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (latestError) {
    throw latestError;
  }

  if (Array.isArray(latestRows) && latestRows[0]?.decision === decision) {
    return false;
  }

  const { error } = await supabase.from("kg_promotions").insert({
    claim_id: claimId,
    decision,
    reason,
    decided_by: "vocabulary_agent",
    payload_json: metadata ?? {}
  });

  if (error) {
    throw error;
  }

  const { error: claimUpdateError } = await supabase
    .from("kg_claims")
    .update({
      status: nextClaimStatus(decision),
      updated_at: new Date().toISOString()
    })
    .eq("id", claimId);

  if (claimUpdateError) {
    throw claimUpdateError;
  }

  return true;
}

async function processVocabularyJob(job, workerId) {
  const spotifyTrackId = asString(job.spotify_track_id) ?? asString(job.payload_json?.spotifyTrackId);

  if (!spotifyTrackId) {
    throw new Error("Vocabulary job is missing spotifyTrackId.");
  }

  const draft = await loadDraft(spotifyTrackId);

  if (!draft) {
    throw new Error(`No translation draft found for ${spotifyTrackId}.`);
  }

  const payload = isRecord(job.payload_json) ? job.payload_json : {};
  const fallbackDraftMemory = isRecord(draft.artistMemory) ? draft.artistMemory : null;
  const artistKeys = asStringArray(payload.artistKeys);
  const artists = await loadArtistMemories(
    artistKeys.length > 0 ? artistKeys : splitArtistCredits(asString(draft.artist) ?? "").map((credit) => credit.key),
    fallbackDraftMemory,
    asString(draft.artist) ?? ""
  );

  const lines = Array.isArray(draft.lines) ? draft.lines.filter((line) => isRecord(line)) : [];
  const lineByOrder = new Map(
    lines
      .map((line) => {
        const order = Number(line.order);
        return Number.isFinite(order) ? [order, line] : null;
      })
      .filter(Boolean)
  );

  const agentSessionId = randomUUID();
  const summary = {
    claimsUpserted: 0,
    evidencesInserted: 0,
    promotionsRecorded: 0,
    artistsProcessed: artists.length
  };

  for (const artist of artists) {
    const entries = buildCombinedArtistEntries(artist.memory);

    for (const entry of entries) {
      const term = asString(entry.term);
      const meaning = asString(entry.meaning);
      const category = asString(entry.category) ?? "entry";
      const termKey = normalizeKey(term);
      const meaningKey = normalizeKey(meaning);

      if (!artist.artistKey || !term || !meaning || !termKey || !meaningKey) {
        continue;
      }

      const matchingLines = findMatchingLines(entry, draft);

      if (matchingLines.length === 0) {
        continue;
      }

      const confidenceScore = category === "preferred_rendering" ? 0.9 : 0.74;
      const claim = await upsertClaim({
        claimKey: buildClaimKey("artist", artist.artistKey, "artist_term_usage_observation", `${termKey}::${meaningKey}`),
        claimType: "artist_term_usage_observation",
        scopeType: "artist",
        scopeKey: artist.artistKey,
        normalizedKey: `${termKey}::${meaningKey}`,
        confidenceScore,
        agentSessionId,
        payload: {
          artistKey: artist.artistKey,
          artistName: artist.displayName,
          spotifyTrackId,
          term,
          meaning,
          note: asString(entry.note),
          aliases: asStringArray(entry.aliases),
          category,
          sourceLanguage: asString(draft.sourceLanguage)
        }
      });

      summary.claimsUpserted += 1;

      for (const line of matchingLines) {
        const order = Number(line.order);
        const sourceLine = lineByOrder.get(order);

        await insertEvidence(claim.id, {
          sourceType: "draft_line",
          spotifyTrackId,
          artistKey: artist.artistKey,
          lineOrder: Number.isFinite(order) ? order : null,
          weight: category === "preferred_rendering" ? 0.86 : 0.7,
          agentSessionId,
          payload: {
            original: asString(sourceLine?.original),
            normalizedOriginal: asString(sourceLine?.normalizedOriginal),
            meaning: asString(sourceLine?.meaning),
            impliedMeaning: asString(sourceLine?.impliedMeaning),
            chosen: asString(sourceLine?.chosen),
            term,
            meaningHint: meaning,
            note: asString(entry.note),
            category
          }
        });
        summary.evidencesInserted += 1;
      }

      await insertEvidence(claim.id, {
        sourceType: "artist_memory",
        spotifyTrackId,
        artistKey: artist.artistKey,
        lineOrder: null,
        weight: category === "preferred_rendering" ? 0.92 : 0.68,
        agentSessionId,
        payload: {
          term,
          meaning,
          note: asString(entry.note),
          aliases: asStringArray(entry.aliases),
          category
        }
      });
      summary.evidencesInserted += 1;

      const latestClaim = await supabase
        .from("kg_claims")
        .select("id, confidence_score, evidence_count")
        .eq("id", claim.id)
        .single();

      if (latestClaim.error) {
        throw latestClaim.error;
      }

      const promotion = decidePromotion(Number(latestClaim.data.confidence_score ?? confidenceScore), Number(latestClaim.data.evidence_count ?? 0));
      const inserted = await maybeInsertPromotion(claim.id, promotion.decision, promotion.reason, {
        claimType: "artist_term_usage_observation",
        confidenceScore: Number(latestClaim.data.confidence_score ?? confidenceScore),
        evidenceCount: Number(latestClaim.data.evidence_count ?? 0),
        workerId
      });

      if (inserted) {
        summary.promotionsRecorded += 1;
      }
    }
  }

  return summary;
}

async function main() {
  const workerId = process.env.LAFZ_AGENT_WORKER_ID?.trim() || `vocabulary-worker-${randomUUID().slice(0, 8)}`;
  const job = await claimNextVocabularyJob(workerId);

  if (!job) {
    console.log("[vocabulary-agent] no pending jobs.");
    return;
  }

  const runId = await insertRun(job.id, workerId, {
    jobKey: job.job_key,
    spotifyTrackId: job.spotify_track_id,
    scopeKey: job.scope_key
  });

  try {
    await updateJob(job.id, {
      status: "running",
      claimed_by: workerId,
      claimed_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString()
    });

    const summary = await processVocabularyJob(job, workerId);

    await updateRun(runId, {
      status: "completed",
      output_json: summary,
      finished_at: new Date().toISOString()
    });

    await updateJob(job.id, {
      status: "completed",
      claimed_by: workerId,
      last_heartbeat_at: new Date().toISOString(),
      last_error: null
    });

    console.log("[vocabulary-agent] completed job", {
      jobKey: job.job_key,
      spotifyTrackId: job.spotify_track_id,
      ...summary
    });
  } catch (error) {
    const errorText = error instanceof Error ? error.message : "Unknown vocabulary agent failure.";

    await updateRun(runId, {
      status: "failed",
      error_text: errorText,
      finished_at: new Date().toISOString()
    }).catch(() => {});

    await updateJob(job.id, {
      status: "failed",
      claimed_by: workerId,
      last_heartbeat_at: new Date().toISOString(),
      last_error: errorText
    }).catch(() => {});

    console.error("[vocabulary-agent] job failed.", {
      jobKey: job.job_key,
      spotifyTrackId: job.spotify_track_id,
      error: errorText
    });
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[vocabulary-agent] fatal error.", error);
  process.exitCode = 1;
});
