import { createClient } from "@supabase/supabase-js";

const DEFAULT_PROMOTION_BATCH_SIZE = 500;
const DEFAULT_CLAIM_BATCH_SIZE = 100;
const DEFAULT_UPSERT_BATCH_SIZE = 200;

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

function asPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    limit: null,
    promotionBatchSize: DEFAULT_PROMOTION_BATCH_SIZE,
    upsertBatchSize: DEFAULT_UPSERT_BATCH_SIZE
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      const parsed = Number.parseInt(arg.slice("--limit=".length), 10);
      options.limit = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      continue;
    }

    if (arg.startsWith("--promotion-batch-size=")) {
      const parsed = Number.parseInt(arg.slice("--promotion-batch-size=".length), 10);
      options.promotionBatchSize = Number.isFinite(parsed) && parsed > 0 ? parsed : options.promotionBatchSize;
      continue;
    }

    if (arg.startsWith("--upsert-batch-size=")) {
      const parsed = Number.parseInt(arg.slice("--upsert-batch-size=".length), 10);
      options.upsertBatchSize = Number.isFinite(parsed) && parsed > 0 ? parsed : options.upsertBatchSize;
    }
  }

  return options;
}

function isManualLearningSignal(decidedBy) {
  if (!decidedBy) {
    return false;
  }

  const normalized = decidedBy.trim().toLowerCase();
  return normalized.startsWith("manual") || normalized.includes("human");
}

function computeBrainLearningBias(profile) {
  const totalSignals = Math.max(0, profile.signalCount);

  if (totalSignals === 0) {
    return 0;
  }

  const directionalScore = profile.acceptedCount - profile.rejectedCount * 1.15 - profile.deferredCount * 0.2;
  const normalizedScore = directionalScore / totalSignals;
  const strength = Math.min(1, totalSignals / 8) * (0.7 + Math.min(1, profile.manualOverrideCount / 4) * 0.3);
  const bias = normalizedScore * strength * 0.22;

  return Math.max(-0.2, Math.min(0.2, bias));
}

function chunk(values, size) {
  const chunks = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

async function fetchAllRows(supabase, table, columns, { batchSize, limit = null, orderBy = "created_at", ascending = true }) {
  const rows = [];
  let from = 0;

  while (true) {
    const remaining = limit !== null && Number.isFinite(limit) ? Math.max(0, limit - rows.length) : batchSize;

    if (remaining === 0) {
      break;
    }

    const pageSize = Math.min(batchSize, remaining);
    const query = supabase.from(table).select(columns).order(orderBy, { ascending }).range(from, from + pageSize - 1);

    const { data, error } = await query;

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

async function fetchClaimsByIds(supabase, claimIds) {
  if (claimIds.length === 0) {
    return [];
  }

  const claims = [];

  for (const idChunk of chunk(claimIds, DEFAULT_CLAIM_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("kg_claims")
      .select("id, claim_type, scope_type, normalized_key")
      .in("id", idChunk);

    if (error) {
      throw error;
    }

    claims.push(...(data ?? []));
  }

  return claims;
}

function buildAggregateKey(claim) {
  return `${claim.scope_type}::${claim.claim_type}::${claim.normalized_key}`;
}

function createEmptyAggregate(claim) {
  return {
    scope_type: claim.scope_type,
    claim_type: claim.claim_type,
    normalized_key: claim.normalized_key,
    signal_count: 0,
    accepted_count: 0,
    rejected_count: 0,
    deferred_count: 0,
    manual_override_count: 0,
    last_decision: null,
    last_decided_by: null,
    last_claim_id: null,
    last_decision_at: null,
    lastDecisionMs: null
  };
}

function applyPromotionToAggregate(aggregate, promotion) {
  aggregate.signal_count += 1;

  if (promotion.decision === "accepted") {
    aggregate.accepted_count += 1;
  }

  if (promotion.decision === "rejected") {
    aggregate.rejected_count += 1;
  }

  if (promotion.decision === "deferred") {
    aggregate.deferred_count += 1;
  }

  if (isManualLearningSignal(promotion.decided_by)) {
    aggregate.manual_override_count += 1;
  }

  const decisionMs = promotion.created_at ? new Date(promotion.created_at).getTime() : Number.NaN;

  if (!Number.isFinite(decisionMs)) {
    return;
  }

  if (aggregate.lastDecisionMs === null || decisionMs >= aggregate.lastDecisionMs) {
    aggregate.lastDecisionMs = decisionMs;
    aggregate.last_decision = promotion.decision;
    aggregate.last_decided_by = promotion.decided_by ?? null;
    aggregate.last_claim_id = promotion.claim_id;
    aggregate.last_decision_at = promotion.created_at ?? null;
  }
}

function finalizeAggregateRows(aggregates) {
  const now = new Date().toISOString();

  return Array.from(aggregates.values())
    .map((aggregate) => {
      const confidenceBias = computeBrainLearningBias({
        signalCount: aggregate.signal_count,
        acceptedCount: aggregate.accepted_count,
        rejectedCount: aggregate.rejected_count,
        deferredCount: aggregate.deferred_count,
        manualOverrideCount: aggregate.manual_override_count
      });

      return {
        scope_type: aggregate.scope_type,
        claim_type: aggregate.claim_type,
        normalized_key: aggregate.normalized_key,
        signal_count: aggregate.signal_count,
        accepted_count: aggregate.accepted_count,
        rejected_count: aggregate.rejected_count,
        deferred_count: aggregate.deferred_count,
        manual_override_count: aggregate.manual_override_count,
        confidence_bias: confidenceBias,
        last_decision: aggregate.last_decision,
        last_decided_by: aggregate.last_decided_by,
        last_claim_id: aggregate.last_claim_id,
        last_decision_at: aggregate.last_decision_at,
        updated_at: now
      };
    })
    .sort((left, right) => right.signal_count - left.signal_count || left.scope_type.localeCompare(right.scope_type));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  console.log("[brain-learning-backfill] starting", {
    dryRun: options.dryRun,
    limit: options.limit,
    promotionBatchSize: options.promotionBatchSize,
    upsertBatchSize: options.upsertBatchSize
  });

  const promotions = await fetchAllRows(supabase, "kg_promotions", "id, claim_id, decision, decided_by, created_at", {
    batchSize: options.promotionBatchSize,
    limit: options.limit,
    orderBy: "created_at",
    ascending: true
  });

  const claimIds = Array.from(new Set(promotions.map((promotion) => asString(promotion.claim_id)).filter(Boolean)));
  const claims = await fetchClaimsByIds(supabase, claimIds);
  const claimById = new Map(claims.map((claim) => [claim.id, claim]));

  const aggregates = new Map();
  let missingClaimCount = 0;
  let ignoredPromotionCount = 0;

  for (const promotion of promotions) {
    const claimId = asString(promotion.claim_id);

    if (!claimId) {
      ignoredPromotionCount += 1;
      continue;
    }

    const claim = claimById.get(claimId);

    if (!claim) {
      missingClaimCount += 1;
      continue;
    }

    const key = buildAggregateKey(claim);
    const existing = aggregates.get(key) ?? createEmptyAggregate(claim);
    applyPromotionToAggregate(existing, promotion);
    aggregates.set(key, existing);
  }

  const rows = finalizeAggregateRows(aggregates);

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          promotionsScanned: promotions.length,
          claimsMatched: claims.length,
          ignoredPromotionCount,
          missingClaimCount,
          profileCount: rows.length,
          topProfiles: rows.slice(0, 8).map((row) => ({
            scopeType: row.scope_type,
            claimType: row.claim_type,
            normalizedKey: row.normalized_key,
            signalCount: row.signal_count,
            confidenceBias: row.confidence_bias,
            lastDecision: row.last_decision,
            lastDecidedBy: row.last_decided_by
          }))
        },
        null,
        2
      )
    );
    return;
  }

  let upsertedCount = 0;

  for (const batch of chunk(rows, options.upsertBatchSize)) {
    const { error } = await supabase.from("kg_learning_profiles").upsert(batch, {
      onConflict: "scope_type,claim_type,normalized_key"
    });

    if (error) {
      throw error;
    }

    upsertedCount += batch.length;
  }

  console.log(
    JSON.stringify(
      {
        promotionsScanned: promotions.length,
        claimsMatched: claims.length,
        ignoredPromotionCount,
        missingClaimCount,
        profileCount: rows.length,
        upsertedCount,
        sampleProfiles: rows.slice(0, 8).map((row) => ({
          scopeType: row.scope_type,
          claimType: row.claim_type,
          normalizedKey: row.normalized_key,
          signalCount: row.signal_count,
          confidenceBias: row.confidence_bias,
          lastDecision: row.last_decision,
          lastDecidedBy: row.last_decided_by
        }))
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("[brain-learning-backfill] failed:");
  console.dir(error, { depth: 8 });
  process.exitCode = 1;
});
