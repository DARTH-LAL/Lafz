import { getCloudDataMetadata, isCloudStorageConfigurationError, readCloudDataJson, writeCloudDataJson } from "@/features/cloud/data-store";
import type { AiCostSummary } from "@/features/ai/types";

const GENERATION_LOG_ROOT = "data/translations/generation-log";
const MAX_LOG_ENTRIES = 50;

export type GenerationLogEntry = {
  id: string;
  timestampMs: number;
  startedAt: string;
  durationMs: number;
  model: string;
  provider: string;
  lineCount: number;
  lowCount: number;
  mediumCount: number;
  highCount: number;
  sourceLanguage: string | null;
  targetLanguage: string;
  resultStatus: string;
  costSummary: AiCostSummary | null;
  glossaryTermsMatched?: string[];
  artistProfileActive?: boolean;
};

type GenerationLogFile = {
  spotifyTrackId: string;
  entries: GenerationLogEntry[];
};

function logStoragePath(spotifyTrackId: string) {
  return `${GENERATION_LOG_ROOT}/${spotifyTrackId}.json`;
}

async function readLogFile(spotifyTrackId: string): Promise<GenerationLogFile> {
  const cloudLog = await readCloudDataJson<GenerationLogFile>(logStoragePath(spotifyTrackId));
  if (cloudLog && Array.isArray(cloudLog.entries)) {
    return {
      spotifyTrackId,
      entries: cloudLog.entries
    };
  }

  return { spotifyTrackId, entries: [] };
}

export async function appendGenerationLogEntry(
  spotifyTrackId: string,
  entry: GenerationLogEntry
): Promise<void> {
  try {
    const log = await readLogFile(spotifyTrackId);
    log.entries = [entry, ...log.entries].slice(0, MAX_LOG_ENTRIES);
    await writeCloudDataJson(logStoragePath(spotifyTrackId), log);
  } catch (error) {
    if (isCloudStorageConfigurationError(error)) {
      throw error;
    }
    // Non-fatal
  }
}

export async function readGenerationLog(
  spotifyTrackId: string
): Promise<GenerationLogEntry[]> {
  const log = await readLogFile(spotifyTrackId);
  return log.entries.sort((a, b) => b.timestampMs - a.timestampMs);
}

export async function inspectGenerationLog(spotifyTrackId: string) {
  const [log, metadata] = await Promise.all([
    readLogFile(spotifyTrackId),
    getCloudDataMetadata(logStoragePath(spotifyTrackId))
  ]);

  return {
    exists: log.entries.length > 0,
    lastModifiedAt: metadata?.lastModifiedAt ?? null,
    entryCount: log.entries.length
  };
}
