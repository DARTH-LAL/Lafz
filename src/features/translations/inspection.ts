import { readFile, stat } from "node:fs/promises";

import { getLocalTranslationFilePath } from "@/features/translations/stubs";
import type { TranslationFileInspection } from "@/features/translations/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getLineCount(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.lines)) {
    return 0;
  }

  return value.lines.length;
}

function deriveLanguage(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  return asString(value.sourceLanguage) ?? asString(value.language);
}

function derivePublished(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.published === "boolean") {
    return value.published;
  }

  if (isRecord(value.studio) && typeof value.studio.published === "boolean") {
    return value.studio.published;
  }

  return false;
}

export async function inspectTranslationFile(spotifyTrackId: string): Promise<TranslationFileInspection> {
  const filePath = getLocalTranslationFilePath(spotifyTrackId);

  try {
    const [fileStats, fileContents] = await Promise.all([stat(filePath), readFile(filePath, "utf8")]);

    try {
      const parsedJson = JSON.parse(fileContents) as unknown;
      const lineCount = getLineCount(parsedJson);

      return {
        exists: true,
        filePath,
        kind: lineCount > 0 ? "translated" : "stub",
        lineCount,
        published: derivePublished(parsedJson),
        lastModifiedAt: fileStats.mtime.toISOString(),
        language: deriveLanguage(parsedJson),
        preview: JSON.stringify(parsedJson, null, 2),
        parsedJson,
        parseError: null
      };
    } catch (error) {
      return {
        exists: true,
        filePath,
        kind: "malformed",
        lineCount: 0,
        published: false,
        lastModifiedAt: fileStats.mtime.toISOString(),
        language: null,
        preview: fileContents,
        parsedJson: null,
        parseError: error instanceof Error ? error.message : "Could not parse translation JSON."
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        exists: false,
        filePath,
        kind: "missing",
        lineCount: 0,
        published: false,
        lastModifiedAt: null,
        language: null,
        preview: null,
        parsedJson: null,
        parseError: null
      };
    }

    throw error;
  }
}
