/**
 * One-time backfill script: reads all existing draft files and imports them
 * into data/ai/usage-runs.json so the analytics dashboard shows historical data.
 *
 * Run with: node scripts/backfill-usage.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DRAFTS_DIR  = path.join(ROOT, "data", "translations", "drafts");
const USAGE_FILE  = path.join(ROOT, "data", "ai", "usage-runs.json");

// ── Token estimation (avg tokens per lyric line, rough but consistent) ──
const AVG_TOKENS_PER_LINE = {
  openai:    { input: 220, output: 80  },   // system + context + line in, draft line out
  anthropic: { input: 230, output: 85  },
  gemini:    { input: 480, output: 40  },   // both drafts + context in, selection out
};

// ── Winner detection from selectorReason text ──
function inferWinner(selectorReason) {
  if (!selectorReason) return "generator_a";
  const lower = selectorReason.toLowerCase();

  // Explicit blend signals
  if (
    lower.includes("blend") ||
    lower.includes("synthesiz") ||
    lower.includes("combination") ||
    lower.includes("combined") ||
    lower.includes("neither") && lower.includes("conserv")
  ) return "blended";

  // Count A/B mentions — last decisive mention wins
  const lastA = Math.max(
    lower.lastIndexOf("generator a"),
    lower.lastIndexOf("gen a"),
    lower.lastIndexOf("choice a"),
    lower.lastIndexOf("option a")
  );
  const lastB = Math.max(
    lower.lastIndexOf("generator b"),
    lower.lastIndexOf("gen b"),
    lower.lastIndexOf("choice b"),
    lower.lastIndexOf("option b")
  );

  if (lastA === -1 && lastB === -1) return "generator_a"; // default
  if (lastB > lastA) return "generator_b";
  return "generator_a";
}

// ── Extract model names from generator field ──
function parseModels(generator) {
  const model = generator?.model ?? "";
  // Format: "A:gpt-5.1 | B:claude-sonnet-4-20250514 | Eval:gemini-2.5-flash | Selected:..."
  const aMatch    = model.match(/A:([^\s|]+)/);
  const bMatch    = model.match(/B:([^\s|]+)/);
  const evalMatch = model.match(/Eval:([^\s|]+)/);

  return {
    generatorAModel: aMatch?.[1]    ?? "gpt-5.1",
    generatorBModel: bMatch?.[1]    ?? "claude-sonnet-4-20250514",
    judgeModel:      evalMatch?.[1] ?? "gemini-2.5-flash",
    isMulti: generator?.provider === "multi",
  };
}

// ── Read existing usage runs to avoid duplicates ──
function readExistingRuns() {
  try {
    if (!fs.existsSync(USAGE_FILE)) return [];
    return JSON.parse(fs.readFileSync(USAGE_FILE, "utf-8"));
  } catch {
    return [];
  }
}

// ── Main ──
const existingRuns = readExistingRuns();
const existingTrackIds = new Set(existingRuns.map(r => `${r.spotifyTrackId}:${r.timestamp}`));

if (!fs.existsSync(DRAFTS_DIR)) {
  console.log("No drafts directory found at", DRAFTS_DIR);
  process.exit(0);
}

const draftFiles = fs.readdirSync(DRAFTS_DIR).filter(f => f.endsWith(".json"));
console.log(`Found ${draftFiles.length} draft files.`);

const newRuns = [];

for (const file of draftFiles) {
  let draft;
  try {
    draft = JSON.parse(fs.readFileSync(path.join(DRAFTS_DIR, file), "utf-8"));
  } catch {
    console.warn(`  ⚠ Could not parse ${file}, skipping.`);
    continue;
  }

  const dedupKey = `${draft.spotifyTrackId}:${draft.generatedAt}`;
  if (existingTrackIds.has(dedupKey)) {
    console.log(`  ↩ ${draft.title} already in usage-runs.json, skipping.`);
    continue;
  }

  const lines = draft.lines ?? [];
  if (lines.length === 0) {
    console.warn(`  ⚠ ${file} has no lines, skipping.`);
    continue;
  }

  const { generatorAModel, generatorBModel, judgeModel, isMulti } = parseModels(draft.generator);

  // Only backfill three-model runs (single-model runs have no comparison data)
  if (!isMulti) {
    console.log(`  ↩ ${draft.title} is a single-model run, skipping.`);
    continue;
  }

  // ── Winner distribution ──
  let winA = 0, winB = 0, winBlend = 0;
  for (const line of lines) {
    const winner = inferWinner(line.selectorReason);
    if (winner === "generator_a") winA++;
    else if (winner === "generator_b") winB++;
    else winBlend++;
  }

  // ── Confidence breakdown ──
  let confHigh = 0, confMed = 0, confLow = 0;
  for (const line of lines) {
    if (line.confidence === "high")   confHigh++;
    else if (line.confidence === "low") confLow++;
    else confMed++;
  }

  // ── Estimated token usage ──
  const n = lines.length;
  const estInputA  = n * AVG_TOKENS_PER_LINE.openai.input;
  const estOutputA = n * AVG_TOKENS_PER_LINE.openai.output;
  const estInputB  = n * AVG_TOKENS_PER_LINE.anthropic.input;
  const estOutputB = n * AVG_TOKENS_PER_LINE.anthropic.output;
  const estInputG  = n * AVG_TOKENS_PER_LINE.gemini.input;
  const estOutputG = n * AVG_TOKENS_PER_LINE.gemini.output;

  // ── Estimated durations (based on typical observed speeds) ──
  const estDurA = n * 1100;   // ~1.1s per line for GPT-5.1
  const estDurB = n * 1500;   // ~1.5s per line for Claude
  const estDurG = n * 380;    // ~0.38s per line for Gemini

  const run = {
    id:              randomUUID(),
    timestamp:       draft.generatedAt ?? new Date().toISOString(),
    spotifyTrackId:  draft.spotifyTrackId,
    title:           draft.title ?? "Unknown",
    artist:          draft.artist ?? "Unknown",
    sourceLanguage:  draft.sourceLanguage ?? "Unknown",
    totalLines:      n,
    winnerDistribution: { generatorA: winA, generatorB: winB, blended: winBlend },
    confidenceBreakdown: { high: confHigh, medium: confMed, low: confLow },
    generatorA: {
      model:        generatorAModel,
      inputTokens:  estInputA,
      outputTokens: estOutputA,
      durationMs:   estDurA,
    },
    generatorB: {
      model:        generatorBModel,
      inputTokens:  estInputB,
      outputTokens: estOutputB,
      durationMs:   estDurB,
    },
    judge: {
      model:        judgeModel,
      inputTokens:  estInputG,
      outputTokens: estOutputG,
      durationMs:   estDurG,
    },
    pipelineDurationMs: estDurA + estDurB + estDurG,
    backfilled: true,   // mark so you know these are estimates
  };

  newRuns.push(run);
  console.log(`  ✓ ${draft.title} by ${draft.artist} — ${n} lines | A:${winA} B:${winB} Blend:${winBlend} | conf H:${confHigh} M:${confMed} L:${confLow}`);
}

if (newRuns.length === 0) {
  console.log("\nNothing to backfill — all drafts already exist in usage-runs.json.");
  process.exit(0);
}

// Merge and write
const allRuns = [...existingRuns, ...newRuns].sort(
  (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
);

fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
fs.writeFileSync(USAGE_FILE, JSON.stringify(allRuns, null, 2));

console.log(`\n✅ Backfilled ${newRuns.length} draft(s) into ${USAGE_FILE}`);
console.log(`   Total runs now: ${allRuns.length}`);
