import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AiDraftLine,
  AiArtistMemory,
  AiTranslationConfidence,
  AiTranslationDraftFile,
  AiTranslationDraftInspection,
  AiSongContext
} from "@/features/ai/types";
import { normalizeLookupText as normalizeRomanizedLookupText } from "@/features/ai/romanized-normalization";
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

function normalizeLookupText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeArtistTokens(value: string) {
  return value
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/gi)
    .map((entry) => normalizeLookupText(entry))
    .filter(Boolean);
}

function scoreDraftMetadataMatch(
  draft: AiTranslationDraftFile,
  target: {
    title: string;
    artist: string;
    album?: string | null;
  }
) {
  const normalizedTitle = normalizeLookupText(target.title);
  const normalizedArtist = normalizeLookupText(target.artist);

  if (!normalizedTitle || normalizeLookupText(draft.title) !== normalizedTitle) {
    return null;
  }

  let score = 0;
  const draftArtist = normalizeLookupText(draft.artist);

  if (draftArtist === normalizedArtist) {
    score += 100;
  } else {
    const targetTokens = new Set(normalizeArtistTokens(target.artist));
    const overlap = normalizeArtistTokens(draft.artist).filter((token) => targetTokens.has(token)).length;

    if (overlap === 0) {
      return null;
    }

    score += overlap * 10;
  }

  if (target.album && normalizeLookupText(draft.album) === normalizeLookupText(target.album)) {
    score += 20;
  }

  return score;
}

function parseStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
}

function parseAiDraftLine(value: unknown, index: number): AiDraftLine {
  if (!isRecord(value)) {
    throw new Error(`AI draft line ${index} is not a JSON object.`);
  }

  const order = asNumber(value.order);
  const original = asString(value.original);
  const normalizedOriginal = asString(value.normalizedOriginal);
  const normalizationNotes = parseStringArray(value.normalizationNotes);
  const meaning = asString(value.meaning) ?? asString(value.literal) ?? asString(value.translated);
  const impliedMeaning =
    value.impliedMeaning === null ? null : typeof value.impliedMeaning === "string" ? value.impliedMeaning.trim() || null : null;
  const register =
    value.register === null ? null : typeof value.register === "string" ? value.register.trim() || null : null;
  const legacyTranslated = asString(value.translated);
  const literal = asString(value.literal) ?? legacyTranslated;
  const natural = asString(value.natural) ?? legacyTranslated;
  const slangAware = asString(value.slangAware) ?? natural ?? literal ?? legacyTranslated;
  const chosen = asString(value.chosen) ?? natural ?? literal ?? legacyTranslated;
  const transliteration =
    value.transliteration === null ? null : typeof value.transliteration === "string" ? value.transliteration.trim() || null : null;
  const note = value.note === null ? null : typeof value.note === "string" ? value.note.trim() || null : null;
  const ambiguity =
    value.ambiguity === null ? null : typeof value.ambiguity === "string" ? value.ambiguity.trim() || null : null;
  const confidence = asConfidence(value.confidence) ?? "medium";
  const selectorReason =
    value.selectorReason === null ? null : typeof value.selectorReason === "string" ? value.selectorReason.trim() || null : null;
  const startMs = value.startMs === null ? null : asNumber(value.startMs);
  const endMs = value.endMs === null ? null : asNumber(value.endMs);

  if (order === null || !original || !chosen || !literal || !natural || !meaning) {
    throw new Error(`AI draft line ${index} is missing required Lafz AI fields.`);
  }

  const finalSlangAware = slangAware ?? natural ?? literal;

  return {
    order,
    original,
    normalizedOriginal: normalizedOriginal ?? normalizeRomanizedLookupText(original) ?? null,
    normalizationNotes,
    meaning,
    impliedMeaning,
    register,
    literal,
    natural,
    slangAware: finalSlangAware,
    chosen,
    translated: chosen,
    transliteration,
    note,
    ambiguity,
    confidence,
    selectorReason,
    startMs,
    endMs
  };
}

function parseSongContext(value: unknown): AiSongContext | null {
  if (!isRecord(value)) {
    return null;
  }

  const summary = asString(value.summary);
  const themes = Array.isArray(value.themes) ? value.themes.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry)) : [];
  const tone = asString(value.tone);
  const notablePhrases = Array.isArray(value.notablePhrases)
    ? value.notablePhrases.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  const speaker = asString(value.speaker);
  const addressee = asString(value.addressee);
  const stance = asString(value.stance);
  const narrativeMode = asString(value.narrativeMode);

  if (!summary || !tone) {
    return null;
  }

  return {
    summary,
    themes,
    tone,
    notablePhrases,
    speaker,
    addressee,
    stance,
    narrativeMode
  };
}

function parseArtistMemory(value: unknown): AiArtistMemory | null {
  if (!isRecord(value)) {
    return null;
  }

  const artistKey = asString(value.artistKey);
  const displayName = asString(value.displayName);
  const translationPreferences = Array.isArray(value.translationPreferences)
    ? value.translationPreferences.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  const recurringThemes = Array.isArray(value.recurringThemes)
    ? value.recurringThemes.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  const toneNotes = Array.isArray(value.toneNotes)
    ? value.toneNotes.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  const notes = Array.isArray(value.notes)
    ? value.notes.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];

  if (!artistKey || !displayName) {
    return null;
  }

  return {
    artistKey,
    displayName,
    translationPreferences,
    recurringThemes,
    toneNotes,
    notes
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
  const songContext = parseSongContext(value.songContext);
  const artistMemory = parseArtistMemory(value.artistMemory);
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
    songContext,
    artistMemory,
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
        lowConfidenceCount: parsedDraftFile.lines.filter((line) => line.confidence === "low").length,
        mediumConfidenceCount: parsedDraftFile.lines.filter((line) => line.confidence === "medium").length,
        highConfidenceCount: parsedDraftFile.lines.filter((line) => line.confidence === "high").length,
        manualReviewCount: parsedDraftFile.lines.filter((line) => line.selectorReason === "Manually reviewed in Lafz.").length,
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
        lowConfidenceCount: 0,
        mediumConfidenceCount: 0,
        highConfidenceCount: 0,
        manualReviewCount: 0,
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
        lowConfidenceCount: 0,
        mediumConfidenceCount: 0,
        highConfidenceCount: 0,
        manualReviewCount: 0,
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

export async function findAiTranslationDraftByMetadata(target: { title: string; artist: string; album?: string | null }) {
  let fileNames: string[] = [];

  try {
    fileNames = (await readdir(aiTranslationDraftsRoot)).filter((fileName) => fileName.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }

  let bestMatch: {
    score: number;
    draft: AiTranslationDraftFile;
  } | null = null;

  for (const fileName of fileNames) {
    const filePath = path.join(aiTranslationDraftsRoot, fileName);
    const fileContents = await readFile(filePath, "utf8");
    const parsedDraft = parseAiTranslationDraftFile(JSON.parse(fileContents) as unknown, filePath);
    const score = scoreDraftMetadataMatch(parsedDraft, target);

    if (score !== null && (!bestMatch || score > bestMatch.score)) {
      bestMatch = {
        score,
        draft: parsedDraft
      };
    }
  }

  return bestMatch?.draft ?? null;
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
