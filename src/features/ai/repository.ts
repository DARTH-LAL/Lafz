import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AiDraftLine,
  AiTranslationConfidence,
  AiTranslationDraftFile,
  AiTranslationDraftInspection
} from "@/features/ai/types";
import type { TrackTranslation } from "@/features/translations/types";

const aiTranslationDraftsRoot = path.join(process.cwd(), "data", "translations", "drafts");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asConfidence(value: unknown): AiTranslationConfidence | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

function parseAiDraftLine(value: unknown, index: number): AiDraftLine {
  if (!isRecord(value)) {
    throw new Error(`AI draft line ${index} is not a JSON object.`);
  }

  const order = asNumber(value.order);
  const original = asString(value.original);
  const legacyTranslated = asString(value.translated);
  const literal = asString(value.literal) ?? legacyTranslated;
  const natural = asString(value.natural) ?? legacyTranslated;
  const chosen = asString(value.chosen) ?? natural ?? literal ?? legacyTranslated;
  const transliteration =
    value.transliteration === null ? null : typeof value.transliteration === "string" ? value.transliteration.trim() || null : null;
  const note = value.note === null ? null : typeof value.note === "string" ? value.note.trim() || null : null;
  const ambiguity =
    value.ambiguity === null ? null : typeof value.ambiguity === "string" ? value.ambiguity.trim() || null : null;
  const confidence = asConfidence(value.confidence) ?? "medium";
  const startMs = value.startMs === null ? null : asNumber(value.startMs);
  const endMs = value.endMs === null ? null : asNumber(value.endMs);

  if (order === null || !original || !chosen || !literal || !natural) {
    throw new Error(`AI draft line ${index} is missing required Lafz AI fields.`);
  }

  return {
    order,
    original,
    literal,
    natural,
    chosen,
    translated: chosen,
    transliteration,
    note,
    ambiguity,
    confidence,
    startMs,
    endMs
  };
}

function parseAiTranslationDraftFile(value: unknown, filePath: string): AiTranslationDraftFile {
  if (!isRecord(value)) {
    throw new Error(`AI draft file ${filePath} is not a JSON object.`);
  }

  const spotifyTrackId = asString(value.spotifyTrackId);
  const title = asString(value.title);
  const artist = asString(value.artist);
  const album = asString(value.album);
  const durationMs = asNumber(value.durationMs);
  const sourceLanguage = asString(value.sourceLanguage);
  const targetLanguage = asString(value.targetLanguage);
  const generatedAt = asString(value.generatedAt);
  const mode = value.mode === "synced" || value.mode === "plain" ? value.mode : null;
  const sourceLyricsKind =
    value.sourceLyricsKind === "synced" || value.sourceLyricsKind === "plain" ? value.sourceLyricsKind : null;
  const generator = isRecord(value.generator) ? value.generator : null;
  const provider = generator?.provider === "openai" || generator?.provider === "ollama" ? generator.provider : null;
  const model = asString(generator?.model);
  const lines = Array.isArray(value.lines) ? value.lines.map((line, index) => parseAiDraftLine(line, index)) : null;

  if (
    !spotifyTrackId ||
    !title ||
    !artist ||
    !album ||
    durationMs === null ||
    !sourceLanguage ||
    !targetLanguage ||
    !generatedAt ||
    !mode ||
    !sourceLyricsKind ||
    !provider ||
    !model ||
    !lines
  ) {
    throw new Error(`AI draft file ${filePath} is missing required Lafz AI fields.`);
  }

  return {
    spotifyTrackId,
    title,
    artist,
    album,
    durationMs,
    sourceLanguage,
    targetLanguage,
    generatedAt,
    mode,
    sourceLyricsKind,
    generator: {
      provider,
      model
    },
    lines
  };
}

export function getAiTranslationDraftFilePath(spotifyTrackId: string) {
  return path.join(aiTranslationDraftsRoot, `${spotifyTrackId}.json`);
}

export async function writeAiTranslationDraftFile(draftFile: AiTranslationDraftFile) {
  await mkdir(aiTranslationDraftsRoot, { recursive: true });
  const filePath = getAiTranslationDraftFilePath(draftFile.spotifyTrackId);
  await writeFile(filePath, `${JSON.stringify(draftFile, null, 2)}\n`, "utf8");
  return filePath;
}

export async function inspectAiTranslationDraftFile(spotifyTrackId: string): Promise<AiTranslationDraftInspection> {
  const filePath = getAiTranslationDraftFilePath(spotifyTrackId);

  try {
    const [fileStats, fileContents] = await Promise.all([stat(filePath), readFile(filePath, "utf8")]);

    try {
      const parsedDraftFile = parseAiTranslationDraftFile(JSON.parse(fileContents) as unknown, filePath);

      return {
        exists: true,
        filePath,
        mode: parsedDraftFile.mode,
        lineCount: parsedDraftFile.lines.length,
        lastModifiedAt: fileStats.mtime.toISOString(),
        sourceLanguage: parsedDraftFile.sourceLanguage,
        targetLanguage: parsedDraftFile.targetLanguage,
        model: parsedDraftFile.generator.model,
        preview: JSON.stringify(parsedDraftFile, null, 2),
        parseError: null
      };
    } catch (error) {
      return {
        exists: true,
        filePath,
        mode: "malformed",
        lineCount: 0,
        lastModifiedAt: fileStats.mtime.toISOString(),
        sourceLanguage: null,
        targetLanguage: null,
        model: null,
        preview: fileContents,
        parseError: error instanceof Error ? error.message : "Could not parse AI draft JSON."
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        exists: false,
        filePath,
        mode: "missing",
        lineCount: 0,
        lastModifiedAt: null,
        sourceLanguage: null,
        targetLanguage: null,
        model: null,
        preview: null,
        parseError: null
      };
    }

    throw error;
  }
}

export async function getAiTranslationDraftByTrackId(spotifyTrackId: string) {
  const filePath = getAiTranslationDraftFilePath(spotifyTrackId);

  try {
    const fileContents = await readFile(filePath, "utf8");
    return parseAiTranslationDraftFile(JSON.parse(fileContents) as unknown, filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export function buildTrackTranslationFromAiDraft(draft: AiTranslationDraftFile): TrackTranslation | null {
  if (draft.mode !== "synced") {
    return null;
  }

  const syncedLines = draft.lines.filter(
    (line): line is typeof line & { startMs: number; endMs: number } =>
      typeof line.startMs === "number" && typeof line.endMs === "number"
  );

  if (syncedLines.length === 0) {
    return null;
  }

  return {
    spotifyTrackId: draft.spotifyTrackId,
    title: draft.title,
    artist: draft.artist,
    sourceLanguage: draft.sourceLanguage,
    targetLanguage: draft.targetLanguage,
    lines: syncedLines.map((line) => ({
      startMs: line.startMs,
      endMs: line.endMs,
      original: line.original,
      translated: line.chosen,
      transliteration: line.transliteration ?? undefined,
      note: line.note ?? undefined
    }))
  };
}
