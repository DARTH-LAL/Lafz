import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AiCostSummary } from "@/features/ai/types";

const GENERATION_LOG_ROOT = path.join(process.cwd(), "data", "translations", "generation-log");
const MAX_LOG_ENTRIES = 50;

// ── Types ─────────────────────────────────────────────────────────────────

export type GenerationLogEntry = {
  id: string;
  timestampMs: number;
  /** ISO string when generation started */
  startedAt: string;
  /** Duration of the full generation pipeline in ms */
  durationMs: number;
  model: string;
  provider: string;
  lineCount: number;
  lowCount: number;
  mediumCount: number;
  highCount: number;
  sourceLanguage: string | null;
  targetLanguage: string;
  /** The terminal result status of the generation */
  resultStatus: string;
  costSummary: AiCostSummary | null;
};

type GenerationLogFile = {
  spotifyTrackId: string;
  entries: GenerationLogEntry[];
};

// ── Helpers ───────────────────────────────────────────────────────────────

function logFilePath(spotifyTrackId: string) {
  return path.join(GENERATION_LOG_ROOT, `${spotifyTrackId}.json`);
}

async function readLogFile(spotifyTrackId: string): Promise<GenerationLogFile> {
  const filePath = logFilePath(spotifyTrackId);
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<GenerationLogFile>;
    return {
      spotifyTrackId,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { spotifyTrackId, entries: [] };
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Append a new generation entry for a track.
 * Non-fatal — if the write fails, generation is not affected.
 */
export async function appendGenerationLogEntry(
  spotifyTrackId: string,
  entry: GenerationLogEntry
): Promise<void> {
  try {
    await mkdir(GENERATION_LOG_ROOT, { recursive: true });
    const log = await readLogFile(spotifyTrackId);
    // Prepend newest first, prune to max
    log.entries = [entry, ...log.entries].slice(0, MAX_LOG_ENTRIES);
    await writeFile(
      logFilePath(spotifyTrackId),
      `${JSON.stringify(log, null, 2)}\n`,
      "utf-8"
    );
  } catch {
    // Non-fatal
  }
}

/**
 * Read all generation log entries for a track, newest first.
 */
export async function readGenerationLog(
  spotifyTrackId: string
): Promise<GenerationLogEntry[]> {
  const log = await readLogFile(spotifyTrackId);
  return log.entries.sort((a, b) => b.timestampMs - a.timestampMs);
}
