import { randomUUID } from "node:crypto";

import { isCloudStorageConfigurationError, readCloudDataJson, writeCloudDataJson } from "@/features/cloud/data-store";

const USAGE_STORAGE_PATH = "data/ai/usage-runs.json";

// Price per 1M tokens (USD) - approximate
const PRICING = {
  openai: { input: 2.0, output: 8.0 },
  anthropic: { input: 3.0, output: 15.0 },
  gemini: { input: 0.15, output: 0.60 },
} as const;

export type AiModelUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
};

export type AiUsageRun = {
  id: string;
  timestamp: string;
  spotifyTrackId: string;
  title: string;
  artist: string;
  sourceLanguage: string;
  totalLines: number;
  winnerDistribution: { generatorA: number; generatorB: number; blended: number };
  confidenceBreakdown: { high: number; medium: number; low: number };
  generatorA: AiModelUsage;
  generatorB: AiModelUsage;
  judge: AiModelUsage;
  pipelineDurationMs: number;
};

let runsCache: AiUsageRun[] | null = null;
let runsLoadPromise: Promise<AiUsageRun[]> | null = null;

async function readRuns(): Promise<AiUsageRun[]> {
  if (runsCache) {
    return [...runsCache];
  }

  if (!runsLoadPromise) {
    runsLoadPromise = readCloudDataJson<AiUsageRun[]>(USAGE_STORAGE_PATH)
      .then((runs) => {
        runsCache = Array.isArray(runs) ? runs : [];
        return [...runsCache];
      })
      .catch((error) => {
        if (isCloudStorageConfigurationError(error)) {
          throw error;
        }
        runsCache = [];
        return [] as AiUsageRun[];
      })
      .finally(() => {
        runsLoadPromise = null;
      });
  }

  return [...(await runsLoadPromise)];
}

async function writeRuns(runs: AiUsageRun[]): Promise<void> {
  runsCache = [...runs];
  await writeCloudDataJson(USAGE_STORAGE_PATH, runs);
}

export async function recordAiUsageRun(run: Omit<AiUsageRun, "id">): Promise<void> {
  const runs = await readRuns();
  runs.push({ id: randomUUID(), ...run });
  await writeRuns(runs);
}

export async function readAiUsageRuns(): Promise<AiUsageRun[]> {
  return readRuns();
}

export async function clearAiUsageRuns(): Promise<void> {
  await writeRuns([]);
}

export async function removeAiUsageRunsForTracks(trackIds: Iterable<string>) {
  const idSet = new Set(trackIds);
  if (idSet.size === 0) {
    return 0;
  }

  const runs = await readRuns();
  const filtered = runs.filter((run) => !idSet.has(run.spotifyTrackId));
  const removedCount = runs.length - filtered.length;

  if (removedCount > 0) {
    await writeRuns(filtered);
  }

  return removedCount;
}

export function calcModelCost(provider: "openai" | "anthropic" | "gemini", inputTokens: number, outputTokens: number): number {
  const p = PRICING[provider];
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}

type AnalyticsPeriod = "24h" | "7d" | "30d" | "all";

export async function getUsageAnalytics(period: AnalyticsPeriod) {
  const allRuns = await readRuns();
  const now = Date.now();

  const cutoff: Record<AnalyticsPeriod, number> = {
    "24h": now - 24 * 60 * 60 * 1000,
    "7d": now - 7 * 24 * 60 * 60 * 1000,
    "30d": now - 30 * 24 * 60 * 60 * 1000,
    "all": 0,
  };

  const runs = allRuns.filter((r) => new Date(r.timestamp).getTime() >= cutoff[period]);

  if (runs.length === 0) {
    return null;
  }

  const totalLines = runs.reduce((s, r) => s + r.totalLines, 0);
  const winA = runs.reduce((s, r) => s + r.winnerDistribution.generatorA, 0);
  const winB = runs.reduce((s, r) => s + r.winnerDistribution.generatorB, 0);
  const winBlend = runs.reduce((s, r) => s + r.winnerDistribution.blended, 0);
  const winTotal = winA + winB + winBlend || 1;

  const confHigh = runs.reduce((s, r) => s + r.confidenceBreakdown.high, 0);
  const confMed = runs.reduce((s, r) => s + r.confidenceBreakdown.medium, 0);
  const confLow = runs.reduce((s, r) => s + r.confidenceBreakdown.low, 0);
  const confTotal = confHigh + confMed + confLow || 1;

  const tokA = {
    input: runs.reduce((s, r) => s + r.generatorA.inputTokens, 0),
    output: runs.reduce((s, r) => s + r.generatorA.outputTokens, 0)
  };
  const tokB = {
    input: runs.reduce((s, r) => s + r.generatorB.inputTokens, 0),
    output: runs.reduce((s, r) => s + r.generatorB.outputTokens, 0)
  };
  const tokG = {
    input: runs.reduce((s, r) => s + r.judge.inputTokens, 0),
    output: runs.reduce((s, r) => s + r.judge.outputTokens, 0)
  };

  const avgDurA = Math.round(runs.reduce((s, r) => s + r.generatorA.durationMs, 0) / runs.length / 1000);
  const avgDurB = Math.round(runs.reduce((s, r) => s + r.generatorB.durationMs, 0) / runs.length / 1000);
  const avgDurG = Math.round(runs.reduce((s, r) => s + r.judge.durationMs, 0) / runs.length / 1000);
  const avgTotal = Math.round(runs.reduce((s, r) => s + r.pipelineDurationMs, 0) / runs.length / 1000);

  const costA = calcModelCost("openai", tokA.input, tokA.output);
  const costB = calcModelCost("anthropic", tokB.input, tokB.output);
  const costG = calcModelCost("gemini", tokG.input, tokG.output);

  const langMap: Record<string, { low: number; total: number }> = {};
  for (const run of runs) {
    const lang = run.sourceLanguage || "Unknown";
    if (!langMap[lang]) langMap[lang] = { low: 0, total: 0 };
    langMap[lang].low += run.confidenceBreakdown.low;
    langMap[lang].total += run.totalLines;
  }

  const languageStats = Object.entries(langMap)
    .map(([lang, v]) => ({ lang, pct: Math.round((v.low / (v.total || 1)) * 100) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 5);

  const recentTracks = [...runs]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5)
    .map((r) => ({
      title: r.title,
      artist: r.artist,
      lines: r.totalLines,
      winnerModel:
        r.winnerDistribution.generatorA >= r.winnerDistribution.generatorB &&
        r.winnerDistribution.generatorA >= r.winnerDistribution.blended
          ? "a"
          : r.winnerDistribution.generatorB >= r.winnerDistribution.blended
            ? "b"
            : "blend",
      confidence:
        r.confidenceBreakdown.low / (r.totalLines || 1) > 0.3
          ? "low"
          : r.confidenceBreakdown.high / (r.totalLines || 1) > 0.5
            ? "high"
            : "medium",
    }));

  return {
    period,
    trackCount: runs.length,
    totalLines,
    winRate: {
      a: Math.round((winA / winTotal) * 100),
      b: Math.round((winB / winTotal) * 100),
      blend: Math.round((winBlend / winTotal) * 100),
    },
    confidence: {
      high: Math.round((confHigh / confTotal) * 100),
      med: Math.round((confMed / confTotal) * 100),
      low: Math.round((confLow / confTotal) * 100),
    },
    generatorA: {
      model: runs[runs.length - 1]?.generatorA.model ?? "GPT-5.1",
      inputTokens: tokA.input,
      outputTokens: tokA.output,
      avgDurationMs: avgDurA,
      cost: costA,
    },
    generatorB: {
      model: runs[runs.length - 1]?.generatorB.model ?? "Claude Sonnet",
      inputTokens: tokB.input,
      outputTokens: tokB.output,
      avgDurationMs: avgDurB,
      cost: costB,
    },
    judge: {
      model: runs[runs.length - 1]?.judge.model ?? "Gemini Flash",
      inputTokens: tokG.input,
      outputTokens: tokG.output,
      avgDurationMs: avgDurG,
      cost: costG,
    },
    speed: { avgDurA, avgDurB, avgDurG, avgTotal },
    languageStats,
    recentTracks,
  };
}
