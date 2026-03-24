import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AiArtistMemory, AiCorrectionExample } from "@/features/ai/types";
import type { AiGlossaryEntry } from "@/features/ai/glossary";

const aiMemoryRoot = path.join(process.cwd(), "data", "ai", "memory", "artists");

function normalizeKey(value: string | null) {
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

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
}

function parsePreferredRenderings(value: unknown) {
  if (!Array.isArray(value)) {
    return [] satisfies AiGlossaryEntry[];
  }

  return value
    .map((entry): AiGlossaryEntry | null => {
      if (!isRecord(entry)) {
        return null;
      }

      const term = asString(entry.term);
      const meaning = asString(entry.meaning) ?? asString(entry.translation);
      const note = asString(entry.note) ?? undefined;

      if (!term || !meaning) {
        return null;
      }

      const normalizedEntry: AiGlossaryEntry = {
        term,
        meaning,
        category: "preferred_rendering"
      };

      if (note) {
        normalizedEntry.note = note;
      }

      return normalizedEntry;
    })
    .filter((entry): entry is AiGlossaryEntry => Boolean(entry));
}

function parseCorrectionExamples(value: unknown) {
  if (!Array.isArray(value)) {
    return [] satisfies AiCorrectionExample[];
  }

  return value
    .map((entry): AiCorrectionExample | null => {
      if (!isRecord(entry)) {
        return null;
      }

      const original = asString(entry.original);
      const chosen = asString(entry.chosen) ?? asString(entry.meaning) ?? asString(entry.translation);
      const note = asString(entry.note);
      const updatedAt = asString(entry.updatedAt);
      const useCount = typeof entry.useCount === "number" && Number.isFinite(entry.useCount) ? entry.useCount : null;

      if (!original || !chosen) {
        return null;
      }

      return {
        original,
        chosen,
        note,
        updatedAt,
        useCount
      };
    })
    .filter((entry): entry is AiCorrectionExample => Boolean(entry));
}

export async function getAiArtistMemory(artist: string | null): Promise<{
  memory: AiArtistMemory | null;
  preferredRenderings: AiGlossaryEntry[];
  correctionExamples: AiCorrectionExample[];
}> {
  const artistKeys = splitArtistNames(artist)
    .map((value) => normalizeKey(value))
    .filter((value): value is string => Boolean(value));

  for (const artistKey of artistKeys) {
    const filePath = path.join(aiMemoryRoot, `${artistKey}.json`);

    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;

      if (!isRecord(parsed)) {
        continue;
      }

      const memory: AiArtistMemory = {
        artistKey,
        displayName: asString(parsed.displayName) ?? artistKey,
        translationPreferences: asStringArray(parsed.translationPreferences),
        recurringThemes: asStringArray(parsed.recurringThemes),
        toneNotes: asStringArray(parsed.toneNotes),
        notes: asStringArray(parsed.notes)
      };

      return {
        memory,
        preferredRenderings: parsePreferredRenderings(parsed.preferredRenderings),
        correctionExamples: parseCorrectionExamples(parsed.correctionExamples)
      };
    } catch {
      continue;
    }
  }

  return {
    memory: null,
    preferredRenderings: [],
    correctionExamples: []
  };
}
