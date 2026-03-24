import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AiCorrectionExample, AiDraftLine, AiTranslationDraftFile } from "@/features/ai/types";

const aiGlossariesRoot = path.join(process.cwd(), "data", "ai", "glossaries", "local");
const artistMemoryRoot = path.join(process.cwd(), "data", "ai", "memory", "artists");

type PreferredRenderingEntry = {
  term: string;
  meaning: string;
  note?: string;
};

type CorrectionExampleEntry = AiCorrectionExample;

type LearnedCorrection = {
  original: string;
  chosen: string;
  note?: string;
};

type LearnedCorrectionsResult = {
  corrections: LearnedCorrection[];
  count: number;
  trackGlossaryPath: string | null;
  artistMemoryPath: string | null;
};

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

function normalizeTermKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parsePreferredRenderings(value: unknown) {
  if (!Array.isArray(value)) {
    return [] satisfies PreferredRenderingEntry[];
  }

  return value
    .map((entry): PreferredRenderingEntry | null => {
      if (!isRecord(entry)) {
        return null;
      }

      const term = asString(entry.term);
      const meaning = asString(entry.meaning) ?? asString(entry.translation);
      const note = asString(entry.note) ?? undefined;

      if (!term || !meaning) {
        return null;
      }

      return {
        term,
        meaning,
        ...(note ? { note } : {})
      };
    })
    .filter((entry): entry is PreferredRenderingEntry => Boolean(entry));
}

function parseCorrectionExamples(value: unknown) {
  if (!Array.isArray(value)) {
    return [] satisfies CorrectionExampleEntry[];
  }

  return value
    .map((entry): CorrectionExampleEntry | null => {
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
    .filter((entry): entry is CorrectionExampleEntry => Boolean(entry));
}

async function readJsonRecord(filePath: string) {
  try {
    const text = await readFile(filePath, "utf8");
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    return null;
  }
}

function mergePreferredRenderings(existingEntries: PreferredRenderingEntry[], corrections: LearnedCorrection[]) {
  const merged = new Map<string, PreferredRenderingEntry>();

  for (const entry of existingEntries) {
    merged.set(normalizeTermKey(entry.term), entry);
  }

  for (const correction of corrections) {
    merged.set(normalizeTermKey(correction.original), {
      term: correction.original,
      meaning: correction.chosen,
      ...(correction.note ? { note: correction.note } : {})
    });
  }

  return Array.from(merged.values()).sort((left, right) => left.term.localeCompare(right.term));
}

function mergeCorrectionExamples(existingEntries: CorrectionExampleEntry[], corrections: LearnedCorrection[]) {
  const merged = new Map<string, CorrectionExampleEntry>();

  for (const entry of existingEntries) {
    merged.set(normalizeTermKey(entry.original), entry);
  }

  for (const correction of corrections) {
    const key = normalizeTermKey(correction.original);
    const existing = merged.get(key);
    const useCount = (existing?.useCount ?? 0) + 1;

    merged.set(key, {
      original: correction.original,
      chosen: correction.chosen,
      note: correction.note ?? null,
      updatedAt: new Date().toISOString(),
      useCount
    });
  }

  return Array.from(merged.values())
    .sort((left, right) => {
      const useCountDelta = (right.useCount ?? 0) - (left.useCount ?? 0);

      if (useCountDelta !== 0) {
        return useCountDelta;
      }

      return left.original.localeCompare(right.original);
    })
    .slice(0, 200);
}

function getLearnedCorrections(previousDraft: AiTranslationDraftFile, nextDraft: AiTranslationDraftFile) {
  const previousByOrder = new Map<number, AiDraftLine>(previousDraft.lines.map((line) => [line.order, line]));
  const learnedCorrections = new Map<string, LearnedCorrection>();

  for (const nextLine of nextDraft.lines) {
    const previousLine = previousByOrder.get(nextLine.order);

    if (!previousLine) {
      continue;
    }

    const previousChosen = previousLine.chosen.trim();
    const nextChosen = nextLine.chosen.trim();
    const previousNote = previousLine.note?.trim() ?? null;
    const nextNote = nextLine.note?.trim() ?? null;

    if (previousChosen === nextChosen && previousNote === nextNote) {
      continue;
    }

    const key = normalizeTermKey(nextLine.original);

    if (!key || !nextChosen) {
      continue;
    }

    learnedCorrections.set(key, {
      original: nextLine.original,
      chosen: nextChosen,
      ...(nextNote ? { note: nextNote } : {})
    });
  }

  return Array.from(learnedCorrections.values());
}

async function writeTrackCorrectionGlossary(spotifyTrackId: string, corrections: LearnedCorrectionsResult["corrections"]) {
  const filePath = path.join(aiGlossariesRoot, "tracks", `${spotifyTrackId}.json`);
  const existing = await readJsonRecord(filePath);
  const mergedPreferredRenderings = mergePreferredRenderings(
    parsePreferredRenderings(existing?.preferredRenderings),
    corrections
  );
  const mergedCorrectionExamples = mergeCorrectionExamples(parseCorrectionExamples(existing?.correctionExamples), corrections);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        ...(existing ?? {}),
        preferredRenderings: mergedPreferredRenderings,
        correctionExamples: mergedCorrectionExamples
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return filePath;
}

async function writeArtistCorrectionMemory(
  artist: string,
  corrections: LearnedCorrectionsResult["corrections"]
) {
  const primaryArtist = splitArtistNames(artist)[0] ?? artist;
  const artistKey = normalizeKey(primaryArtist);

  if (!artistKey) {
    return null;
  }

  const filePath = path.join(artistMemoryRoot, `${artistKey}.json`);
  const existing = await readJsonRecord(filePath);
  const mergedPreferredRenderings = mergePreferredRenderings(
    parsePreferredRenderings(existing?.preferredRenderings),
    corrections
  );
  const mergedCorrectionExamples = mergeCorrectionExamples(parseCorrectionExamples(existing?.correctionExamples), corrections);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        displayName: asString(existing?.displayName) ?? primaryArtist,
        translationPreferences: asStringArray(existing?.translationPreferences),
        recurringThemes: asStringArray(existing?.recurringThemes),
        toneNotes: asStringArray(existing?.toneNotes),
        notes: asStringArray(existing?.notes),
        preferredRenderings: mergedPreferredRenderings,
        correctionExamples: mergedCorrectionExamples
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return filePath;
}

export async function learnFromDraftCorrections(previousDraft: AiTranslationDraftFile, nextDraft: AiTranslationDraftFile) {
  const corrections = getLearnedCorrections(previousDraft, nextDraft);

  if (corrections.length === 0) {
    return {
      corrections,
      count: 0,
      trackGlossaryPath: null,
      artistMemoryPath: null
    } satisfies LearnedCorrectionsResult;
  }

  const [trackGlossaryPath, artistMemoryPath] = await Promise.all([
    writeTrackCorrectionGlossary(nextDraft.spotifyTrackId, corrections).catch(() => null),
    writeArtistCorrectionMemory(nextDraft.artist, corrections).catch(() => null)
  ]);

  return {
    corrections,
    count: corrections.length,
    trackGlossaryPath,
    artistMemoryPath
  } satisfies LearnedCorrectionsResult;
}

export async function getTrackCorrectionExamples(spotifyTrackId: string) {
  const filePath = path.join(aiGlossariesRoot, "tracks", `${spotifyTrackId}.json`);
  const existing = await readJsonRecord(filePath);
  return parseCorrectionExamples(existing?.correctionExamples);
}
