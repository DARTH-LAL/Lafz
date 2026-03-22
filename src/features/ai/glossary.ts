import { readFile } from "node:fs/promises";
import path from "node:path";

export type AiGlossaryEntry = {
  term: string;
  meaning: string;
  note?: string;
  category?: "entry" | "slang" | "idiom" | "phrase" | "reference" | "preferred_rendering";
};

const aiGlossariesRoot = path.join(process.cwd(), "data", "ai", "glossaries");

function normalizeGlossaryKey(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : null;
}

function splitArtistNames(artist: string | null) {
  if (!artist) {
    return [];
  }

  return artist
    .split(/,|&| feat\. | ft\. /i)
    .map((value) => value.trim())
    .filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseGlossaryArray(value: unknown, category: AiGlossaryEntry["category"]) {
  if (!Array.isArray(value)) {
    return [] satisfies AiGlossaryEntry[];
  }

  return value
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const term = asString(entry.term);
      const meaning = asString(entry.meaning);
      const note = asString(entry.note) ?? undefined;

      if (!term || !meaning) {
        return null;
      }

      const normalizedEntry: AiGlossaryEntry = {
        term,
        meaning,
        category
      };

      if (note) {
        normalizedEntry.note = note;
      }

      return normalizedEntry;
    })
    .filter((entry): entry is AiGlossaryEntry => Boolean(entry));
}

function parseGlossaryEntries(value: unknown) {
  const candidateEntries = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.entries)
      ? value.entries
      : null;

  const categorizedEntries = isRecord(value)
    ? [
        ...parseGlossaryArray(value.entries, "entry"),
        ...parseGlossaryArray(value.slang, "slang"),
        ...parseGlossaryArray(value.idioms, "idiom"),
        ...parseGlossaryArray(value.phrases, "phrase"),
        ...parseGlossaryArray(value.references, "reference"),
        ...parseGlossaryArray(value.preferredRenderings, "preferred_rendering")
      ]
    : [];

  if (categorizedEntries.length > 0) {
    return categorizedEntries;
  }

  if (!candidateEntries) {
    return [] satisfies AiGlossaryEntry[];
  }

  return parseGlossaryArray(candidateEntries, "entry");
}

async function readGlossaryFile(filePath: string) {
  try {
    const text = await readFile(filePath, "utf8");
    return parseGlossaryEntries(JSON.parse(text) as unknown);
  } catch {
    return [] satisfies AiGlossaryEntry[];
  }
}

function mergeGlossaries(glossaries: AiGlossaryEntry[][]) {
  const merged = new Map<string, AiGlossaryEntry>();

  for (const glossary of glossaries) {
    for (const entry of glossary) {
      merged.set(entry.term.trim().toLowerCase(), entry);
    }
  }

  return Array.from(merged.values());
}

export async function getAiGlossaryEntries(options: {
  language: string | null;
  artist?: string | null;
  spotifyTrackId?: string | null;
}) {
  const languageKey = normalizeGlossaryKey(options.language);
  const artistKeys = splitArtistNames(options.artist ?? null)
    .map((value) => normalizeGlossaryKey(value))
    .filter((value): value is string => Boolean(value));
  const sampleCommonPath = path.join(aiGlossariesRoot, "samples", "common.json");
  const localCommonPath = path.join(aiGlossariesRoot, "local", "common.json");

  const filePaths = [
    sampleCommonPath,
    languageKey ? path.join(aiGlossariesRoot, "samples", `${languageKey}.json`) : null,
    localCommonPath,
    languageKey ? path.join(aiGlossariesRoot, "local", `${languageKey}.json`) : null,
    ...artistKeys.map((artistKey) => path.join(aiGlossariesRoot, "local", "artists", `${artistKey}.json`)),
    options.spotifyTrackId ? path.join(aiGlossariesRoot, "local", "tracks", `${options.spotifyTrackId}.json`) : null
  ].filter((filePath): filePath is string => Boolean(filePath));

  const glossaries = await Promise.all(filePaths.map(readGlossaryFile));
  return mergeGlossaries(glossaries);
}
