import { deleteCloudDataJson, isCloudStorageConfigurationError, listCloudDataKeys, readCloudDataJson, writeCloudDataJson } from "@/features/cloud/data-store";
import type { AiTranslationDraftFile } from "@/features/ai/types";

const BACKUPS_ROOT = "data/translations/backups";
const ACTIVE_DRAFTS_ROOT = "data/translations/drafts";
const MAX_VERSIONS_PER_TRACK = 10;

function backupFileName(spotifyTrackId: string, timestampMs: number) {
  return `${spotifyTrackId}.${timestampMs}.json`;
}

function parseBackupFileName(fileName: string): { spotifyTrackId: string; timestampMs: number } | null {
  const match = fileName.match(/^(.+)\.(\d+)\.json$/);
  if (!match) return null;
  return { spotifyTrackId: match[1], timestampMs: Number(match[2]) };
}

function backupStoragePath(spotifyTrackId: string, timestampMs: number) {
  return `${BACKUPS_ROOT}/${backupFileName(spotifyTrackId, timestampMs)}`;
}

function activeDraftStoragePath(spotifyTrackId: string) {
  return `${ACTIVE_DRAFTS_ROOT}/${spotifyTrackId}.json`;
}

export type DraftVersion = {
  spotifyTrackId: string;
  timestampMs: number;
  generatedAt: string;
  model: string;
  provider: string;
  lineCount: number;
  lowCount: number;
  mediumCount: number;
  highCount: number;
  sourceLanguage: string | null;
  targetLanguage: string;
};

export async function backupDraftBeforeOverwrite(
  spotifyTrackId: string,
  _currentDraftPath: string
): Promise<void> {
  let currentDraft = await readCloudDataJson<AiTranslationDraftFile>(activeDraftStoragePath(spotifyTrackId));

  if (!currentDraft) {
    const { getAiTranslationDraftByTrackId } = await import("@/features/ai/repository");
    currentDraft = await getAiTranslationDraftByTrackId(spotifyTrackId);
  }

  if (!currentDraft) return;

  try {
    const timestampMs = Date.now();
    await writeCloudDataJson(backupStoragePath(spotifyTrackId, timestampMs), currentDraft);
    await pruneOldVersions(spotifyTrackId);
  } catch (error) {
    if (isCloudStorageConfigurationError(error)) {
      throw error;
    }
    // Non-fatal
  }
}

export async function listDraftVersions(spotifyTrackId: string): Promise<DraftVersion[]> {
  try {
    const keys = await listCloudDataKeys(BACKUPS_ROOT);
    const matchingKeys = keys.filter((key) => key.endsWith(".json") && key.includes(`/${spotifyTrackId}.`));
    const versions: DraftVersion[] = [];

    for (const key of matchingKeys) {
      const fileName = key.split("/").pop();
      const parsed = fileName ? parseBackupFileName(fileName) : null;
      if (!parsed || parsed.spotifyTrackId !== spotifyTrackId) continue;

      try {
        const data = await readCloudDataJson<Partial<AiTranslationDraftFile>>(key);
        const lines = Array.isArray(data?.lines) ? data.lines : [];

        versions.push({
          spotifyTrackId,
          timestampMs: parsed.timestampMs,
          generatedAt: data?.generatedAt ?? new Date(parsed.timestampMs).toISOString(),
          model: data?.generator?.model ?? "unknown",
          provider: data?.generator?.provider ?? "unknown",
          lineCount: lines.length,
          lowCount: lines.filter((l) => l.confidence === "low").length,
          mediumCount: lines.filter((l) => l.confidence === "medium").length,
          highCount: lines.filter((l) => l.confidence === "high").length,
          sourceLanguage: data?.sourceLanguage ?? null,
          targetLanguage: data?.targetLanguage ?? "English",
        });
      } catch (error) {
        if (isCloudStorageConfigurationError(error)) {
          throw error;
        }
        continue;
      }
    }

    return versions.sort((a, b) => b.timestampMs - a.timestampMs);
  } catch (error) {
    if (isCloudStorageConfigurationError(error)) {
      throw error;
    }
    return [];
  }
}

export async function getDraftVersion(
  spotifyTrackId: string,
  timestampMs: number
): Promise<AiTranslationDraftFile | null> {
  return readCloudDataJson<AiTranslationDraftFile>(backupStoragePath(spotifyTrackId, timestampMs));
}

export async function restoreDraftVersion(
  spotifyTrackId: string,
  timestampMs: number,
  _activeDraftPath: string
): Promise<boolean> {
  try {
    const version = await getDraftVersion(spotifyTrackId, timestampMs);
    if (!version) return false;

    await backupDraftBeforeOverwrite(spotifyTrackId, "");
    const { writeAiTranslationDraftFile } = await import("@/features/ai/repository");
    await writeAiTranslationDraftFile(version);
    return true;
  } catch (error) {
    if (isCloudStorageConfigurationError(error)) {
      throw error;
    }
    return false;
  }
}

export async function deleteDraftVersion(
  spotifyTrackId: string,
  timestampMs: number
): Promise<void> {
  try {
    await deleteCloudDataJson(backupStoragePath(spotifyTrackId, timestampMs));
  } catch (error) {
    if (isCloudStorageConfigurationError(error)) {
      throw error;
    }
    // ignore
  }
}

async function pruneOldVersions(spotifyTrackId: string) {
  try {
    const versions = await listDraftVersions(spotifyTrackId);
    if (versions.length <= MAX_VERSIONS_PER_TRACK) return;

    const toDelete = versions.slice(MAX_VERSIONS_PER_TRACK);
    await Promise.all(toDelete.map((v) => deleteDraftVersion(v.spotifyTrackId, v.timestampMs)));
  } catch (error) {
    if (isCloudStorageConfigurationError(error)) {
      throw error;
    }
    // ignore
  }
}
