import { createClient } from "@supabase/supabase-js";

function requiredEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }

  return value;
}

function requiredAnyEnv(names) {
  for (const name of names) {
    const value = process.env[name]?.trim();

    if (value) {
      return value;
    }
  }

  throw new Error(`Missing required env var: one of ${names.join(", ")}`);
}

function normalizeText(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  return normalized.length > 0 ? normalized : null;
}

async function fetchAllRows(queryFactory, batchSize = 200) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + batchSize - 1;
    const { data, error } = await queryFactory(from, to);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    rows.push(...data);

    if (data.length < batchSize) {
      break;
    }

    from += batchSize;
  }

  return rows;
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function countReviewedLines(lines) {
  if (!Array.isArray(lines)) {
    return 0;
  }

  return lines.filter((line) => line?.selectorReason === "Manually reviewed in Lafz.").length;
}

function listReviewedLines(lines) {
  if (!Array.isArray(lines)) {
    return [];
  }

  return lines.filter((line) => line?.selectorReason === "Manually reviewed in Lafz.");
}

function extractExpectedRenderingTerms(draft) {
  const originalLines = Array.isArray(draft?.lines)
    ? draft.lines.map((line) => normalizeText(line?.original)).filter(Boolean)
    : [];
  const renderings = Array.isArray(draft?.artistMemory?.canonicalRenderings)
    ? draft.artistMemory.canonicalRenderings
    : [];

  return renderings
    .filter((entry) => normalizeText(entry?.term) && originalLines.some((line) => line.includes(normalizeText(entry.term))))
    .map((entry) => ({
      term: normalizeText(entry.term),
      rendering: normalizeText(entry.rendering)
    }))
    .filter((entry) => entry.term && entry.rendering);
}

function buildCacheKey(artist, spotifyTrackId) {
  const artistKeys = String(artist ?? "")
    .split(/\s*(?:,|&|\band\b|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bx\b)\s*/i)
    .map((value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
    .filter(Boolean)
    .sort();

  return `translation:${artistKeys.join(",")}:${spotifyTrackId}`;
}

async function main() {
  const supabaseUrl = requiredAnyEnv(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const supabaseServiceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false }
  });

  const [draftRows, cacheRows] = await Promise.all([
    fetchAllRows((from, to) => supabase.from("translation_drafts").select("spotify_track_id,draft_json,updated_at").range(from, to)),
    fetchAllRows((from, to) => supabase.from("memory_pack_cache").select("cache_key,payload_json,updated_at").range(from, to))
  ]);

  const cacheMap = new Map(cacheRows.map((row) => [row.cache_key, row]));
  const sample = [];
  const renderingCoverage = [];
  const symbolCoverage = [];
  const relationshipCoverage = [];
  const sourceSongCounts = [];
  const reviewedLineCounts = [];
  const humanGroundedSamples = [];
  const reviewedRenderingSupport = [];
  const reviewedSymbolSupport = [];

  for (const row of draftRows) {
    const draft = row.draft_json ?? {};
    const cacheKey = buildCacheKey(draft.artist, row.spotify_track_id);
    const cache = cacheMap.get(cacheKey);
    const pack = cache?.payload_json ?? null;

    if (!pack) {
      continue;
    }

    const expectedRenderings = extractExpectedRenderingTerms(draft);
    const packRenderings = Array.isArray(pack.renderingHints)
      ? pack.renderingHints.map((entry) => ({ term: normalizeText(entry.term), meaning: normalizeText(entry.meaning) }))
      : [];
    const renderingHits = expectedRenderings.filter((expected) =>
      packRenderings.some((entry) => entry.term === expected.term && entry.meaning === expected.rendering)
    ).length;

    const expectedSymbols = Array.isArray(draft?.worldModel?.recurringSymbols)
      ? draft.worldModel.recurringSymbols.map((value) => normalizeText(value)).filter(Boolean)
      : [];
    const packSymbols = Array.isArray(pack.symbolHints)
      ? pack.symbolHints.map((entry) => normalizeText(entry.symbol)).filter(Boolean)
      : [];
    const symbolHits = expectedSymbols.filter((symbol) => packSymbols.includes(symbol)).length;

    const expectedRelationships = Array.isArray(draft?.worldModel?.relationshipGraph)
      ? draft.worldModel.relationshipGraph
          .map((entry) => {
            const dynamic = typeof entry?.dynamic === "string" ? entry.dynamic.trim() : null;
            const powerBalance = typeof entry?.powerBalance === "string" ? entry.powerBalance.trim() : null;
            if (!dynamic) return null;
            return normalizeText(powerBalance ? `${dynamic} (${powerBalance})` : dynamic);
          })
          .filter(Boolean)
      : [];
    const packRelationships = Array.isArray(pack.relationshipPriors)
      ? pack.relationshipPriors.map((entry) => normalizeText(entry)).filter(Boolean)
      : [];
    const relationshipHits = expectedRelationships.filter((entry) => packRelationships.includes(entry)).length;

    const reviewedLines = listReviewedLines(draft.lines);
    const reviewedLineCount = reviewedLines.length;
    reviewedLineCounts.push(reviewedLineCount);
    sourceSongCounts.push(Array.isArray(pack.sourceSongIds) ? pack.sourceSongIds.length : 0);
    renderingCoverage.push(expectedRenderings.length === 0 ? 1 : renderingHits / expectedRenderings.length);
    symbolCoverage.push(expectedSymbols.length === 0 ? 1 : symbolHits / expectedSymbols.length);
    relationshipCoverage.push(expectedRelationships.length === 0 ? 1 : relationshipHits / expectedRelationships.length);

    sample.push({
      spotifyTrackId: row.spotify_track_id,
      title: draft.title,
      artist: draft.artist,
      reviewedLines: reviewedLineCount,
      sourceSongs: Array.isArray(pack.sourceSongIds) ? pack.sourceSongIds.length : 0,
      renderingCoverage: Number((expectedRenderings.length === 0 ? 1 : renderingHits / expectedRenderings.length).toFixed(2)),
      symbolCoverage: Number((expectedSymbols.length === 0 ? 1 : symbolHits / expectedSymbols.length).toFixed(2)),
      relationshipCoverage: Number((expectedRelationships.length === 0 ? 1 : relationshipHits / expectedRelationships.length).toFixed(2))
    });

    if (reviewedLineCount > 0) {
      const packRenderings = Array.isArray(pack.renderingHints)
        ? pack.renderingHints.map((entry) => ({
            term: normalizeText(entry.term),
            meaning: normalizeText(entry.meaning)
          }))
        : [];
      const packSymbols = Array.isArray(pack.symbolHints)
        ? pack.symbolHints.map((entry) => normalizeText(entry.symbol)).filter(Boolean)
        : [];

      const reviewedRenderingHits = reviewedLines.filter((line) => {
        const original = normalizeText(line?.original);
        const chosen = normalizeText(line?.chosen);

        if (!original || !chosen) {
          return false;
        }

        return packRenderings.some((entry) =>
          entry.term &&
          entry.meaning &&
          original.includes(entry.term) &&
          chosen.includes(entry.meaning)
        );
      }).length;

      const reviewedSymbolHits = reviewedLines.filter((line) => {
        const original = normalizeText(line?.original);

        if (!original) {
          return false;
        }

        return packSymbols.some((symbol) => symbol && original.includes(symbol));
      }).length;

      reviewedRenderingSupport.push(reviewedRenderingHits / reviewedLineCount);
      reviewedSymbolSupport.push(reviewedSymbolHits / reviewedLineCount);
      humanGroundedSamples.push({
        spotifyTrackId: row.spotify_track_id,
        title: draft.title,
        artist: draft.artist,
        reviewedLines: reviewedLineCount,
        reviewedRenderingSupport: Number((reviewedRenderingHits / reviewedLineCount).toFixed(2)),
        reviewedSymbolSupport: Number((reviewedSymbolHits / reviewedLineCount).toFixed(2))
      });
    }
  }

  const humanGroundedStatus = humanGroundedSamples.length > 0 ? "ok" : "insufficient_review_signal";

  const report = {
    generatedAt: new Date().toISOString(),
    totals: {
      drafts: draftRows.length,
      packs: cacheRows.length,
      benchmarkedDrafts: sample.length
    },
    structuralCoverage: {
      avgSourceSongsPerPack: Number(average(sourceSongCounts).toFixed(2)),
      avgReviewedLinesPerDraft: Number(average(reviewedLineCounts).toFixed(2)),
      renderingCoverage: Number(average(renderingCoverage).toFixed(2)),
      symbolCoverage: Number(average(symbolCoverage).toFixed(2)),
      relationshipCoverage: Number(average(relationshipCoverage).toFixed(2))
    },
    humanGrounded: {
      status: humanGroundedStatus,
      benchmarkableDrafts: humanGroundedSamples.length,
      avgReviewedRenderingSupport:
        humanGroundedSamples.length > 0 ? Number(average(reviewedRenderingSupport).toFixed(2)) : null,
      avgReviewedSymbolSupport:
        humanGroundedSamples.length > 0 ? Number(average(reviewedSymbolSupport).toFixed(2)) : null,
      note:
        humanGroundedStatus === "ok"
          ? "Uses manually reviewed lines only."
          : "No manually reviewed draft lines were found, so human-grounded lift cannot be measured yet."
    },
    weakestExamples: [...sample]
      .sort((left, right) => (left.renderingCoverage + left.symbolCoverage + left.relationshipCoverage) - (right.renderingCoverage + right.symbolCoverage + right.relationshipCoverage))
      .slice(0, 10),
    strongestExamples: [...sample]
      .sort((left, right) => (right.renderingCoverage + right.symbolCoverage + right.relationshipCoverage) - (left.renderingCoverage + left.symbolCoverage + left.relationshipCoverage))
      .slice(0, 10),
    humanGroundedExamples: humanGroundedSamples.slice(0, 10)
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
