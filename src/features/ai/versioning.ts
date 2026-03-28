import fs from "node:fs";
import { copyFile, mkdir, readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";

import type { AiTranslationDraftFile } from "@/features/ai/types";

const BACKUPS_ROOT = path.join(process.cwd(), "data", "translations", "backups");
const MAX_VERSIONS_PER_TRACK = 10;

// ── File name helpers ────────────────────────────────────────────────────

function backupFileName(spotifyTrackId: string, timestampMs: number) {
  return `${spotifyTrackId}.${timestampMs}.json`;
}

function parseBackupFileName(fileName: string): { spotifyTrackId: string; timestampMs: number } | null {
  // Pattern: {spotifyTrackId}.{timestampMs}.json
  const match = fileName.match(/^(.+)\.(\d+)\.json$/);
  if (!match) return null;
  return { spotifyTrackId: match[1], timestampMs: Number(match[2]) };
}

function backupFilePath(spotifyTrackId: string, timestampMs: number) {
  return path.join(BACKUPS_ROOT, backupFileName(spotifyTrackId, timestampMs));
}

// ── Public API ────────────────────────────────────────────────────────────

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

/**
 * Before overwriting a draft, call this to snapshot the current one.
 * Prunes oldest backups beyond MAX_VERSIONS_PER_TRACK.
 */
export async function backupDraftBeforeOverwrite(
  spotifyTrackId: string,
  currentDraftPath: string
): Promise<void> {
  if (!fs.existsSync(currentDraftPath)) return;

  try {
    await mkdir(BACKUPS_ROOT, { recursive: true });
    const timestampMs = Date.now();
    await copyFile(currentDraftPath, backupFilePath(spotifyTrackId, timestampMs));
    await pruneOldVersions(spotifyTrackId);
  } catch {
    // Non-fatal — versioning should never block a save
  }
}

/**
 * List all saved versions for a track, newest first.
 */
export async function listDraftVersions(spotifyTrackId: string): Promise<DraftVersion[]> {
  try {
    await mkdir(BACKUPS_ROOT, { recursive: true });
    const files = await readdir(BACKUPS_ROOT);
    const versions: DraftVersion[] = [];

    for (const file of files) {
      const parsed = parseBackupFileName(file);
      if (!parsed || parsed.spotifyTrackId !== spotifyTrackId) continue;

      try {
        const raw = await readFile(path.join(BACKUPS_ROOT, file), "utf-8");
        const data = JSON.parse(raw) as Partial<AiTranslationDraftFile>;
        const lines = Array.isArray(data.lines) ? data.lines : [];

        versions.push({
          spotifyTrackId,
          timestampMs: parsed.timestampMs,
          generatedAt: data.generatedAt ?? new Date(parsed.timestampMs).toISOString(),
          model: data.generator?.model ?? "unknown",
          provider: data.generator?.provider ?? "unknown",
          lineCount: lines.length,
          lowCount: lines.filter((l) => l.confidence === "low").length,
          mediumCount: lines.filter((l) => l.confidence === "medium").length,
          highCount: lines.filter((l) => l.confidence === "high").length,
          sourceLanguage: data.sourceLanguage ?? null,
          targetLanguage: data.targetLanguage ?? "English",
        });
      } catch {
        // Skip malformed backups
      }
    }

    return versions.sort((a, b) => b.timestampMs - a.timestampMs);
  } catch {
    return [];
  }
}

/**
 * Read the full content of a specific version.
 */
export async function getDraftVersion(
  spotifyTrackId: string,
  timestampMs: number
): Promise<AiTranslationDraftFile | null> {
  try {
    const filePath = backupFilePath(spotifyTrackId, timestampMs);
    if (!fs.existsSync(filePath)) return null;
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw) as AiTranslationDraftFile;
  } catch {
    return null;
  }
}

/**
 * Restore a version — copies it back as the active draft.
 * The current active draft is backed up first.
 */
export async function restoreDraftVersion(
  spotifyTrackId: string,
  timestampMs: number,
  activeDraftPath: string
): Promise<boolean> {
  try {
    const srcPath = backupFilePath(spotifyTrackId, timestampMs);
    if (!fs.existsSync(srcPath)) return false;

    // Backup current before restoring
    await backupDraftBeforeOverwrite(spotifyTrackId, activeDraftPath);

    // Copy version back as active
    await mkdir(path.dirname(activeDraftPath), { recursive: true });
    await copyFile(srcPath, activeDraftPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a specific backup version.
 */
export async function deleteDraftVersion(
  spotifyTrackId: string,
  timestampMs: number
): Promise<void> {
  try {
    await unlink(backupFilePath(spotifyTrackId, timestampMs));
  } catch {
    // ignore
  }
}

// ── Pruning ───────────────────────────────────────────────────────────────

async function pruneOldVersions(spotifyTrackId: string) {
  try {
    const versions = await listDraftVersions(spotifyTrackId);
    if (versions.length <= MAX_VERSIONS_PER_TRACK) return;

    // Delete the oldest beyond the limit
    const toDelete = versions.slice(MAX_VERSIONS_PER_TRACK);
    await Promise.all(toDelete.map((v) => deleteDraftVersion(v.spotifyTrackId, v.timestampMs)));
  } catch {
    // ignore
  }
}
