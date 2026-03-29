import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AiArtistMemory, AiCanonicalRendering } from "@/features/ai/types";

const artistProfilesRoot = path.join(process.cwd(), "data", "ai", "memory", "artists");

type ArtistProfileFields = Omit<AiArtistMemory, "glossaryEntries" | "artistKey">;

export type ArtistProfileFile = ArtistProfileFields & {
  artistKey: string;
  updatedAt: string;
  /** How many songs were used when the profile was last generated */
  builtFromSongs?: number;
  /** How many glossary entries existed when the profile was last generated */
  builtFromGlossaryTerms?: number;
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

function parseCanonicalRenderings(value: unknown): AiCanonicalRendering[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): AiCanonicalRendering | null => {
      if (!isRecord(item)) return null;
      const term = asString(item.term);
      const rendering = asString(item.rendering);
      if (!term || !rendering) return null;
      const note = asString(item.note) ?? undefined;
      return note ? { term, rendering, note } : { term, rendering };
    })
    .filter((r): r is AiCanonicalRendering => r !== null);
}

function emptyProfile(artistKey: string) {
  return {
    artistKey,
    displayName: artistKey,
    updatedAt: new Date().toISOString(),
    personaSummary: null,
    translationPreferences: [],
    translationDirectives: [],
    recurringThemes: [],
    recurringMotifs: [],
    relationshipPatterns: [],
    toneNotes: [],
    voiceNotes: [],
    stanceNotes: [],
    perspectiveNotes: [],
    notes: [],
    canonicalRenderings: []
  } satisfies ArtistProfileFile;
}

export function hasArtistProfileContent(
  profile:
    | Pick<
        ArtistProfileFile,
        | "personaSummary"
        | "translationPreferences"
        | "translationDirectives"
        | "recurringThemes"
        | "recurringMotifs"
        | "relationshipPatterns"
        | "toneNotes"
        | "voiceNotes"
        | "stanceNotes"
        | "perspectiveNotes"
        | "notes"
      >
    | null
) {
  if (!profile) {
    return false;
  }

  return Boolean(
    profile.personaSummary ||
      profile.translationPreferences.length ||
      profile.translationDirectives.length ||
      profile.recurringThemes.length ||
      profile.recurringMotifs.length ||
      profile.relationshipPatterns.length ||
      profile.toneNotes.length ||
      profile.voiceNotes.length ||
      profile.stanceNotes.length ||
      profile.perspectiveNotes.length ||
      profile.notes.length
  );
}

export async function readArtistProfileFile(artistKey: string): Promise<ArtistProfileFile> {
  const filePath = path.join(artistProfilesRoot, `${artistKey}.json`);

  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;

    if (!isRecord(parsed)) {
      return emptyProfile(artistKey);
    }

    return {
      artistKey,
      displayName: asString(parsed.displayName) ?? artistKey,
      updatedAt: asString(parsed.updatedAt) ?? new Date().toISOString(),
      builtFromSongs: typeof parsed.builtFromSongs === "number" ? parsed.builtFromSongs : undefined,
      builtFromGlossaryTerms: typeof parsed.builtFromGlossaryTerms === "number" ? parsed.builtFromGlossaryTerms : undefined,
      personaSummary: asString(parsed.personaSummary),
      translationPreferences: asStringArray(parsed.translationPreferences),
      translationDirectives: asStringArray(parsed.translationDirectives),
      recurringThemes: asStringArray(parsed.recurringThemes),
      recurringMotifs: asStringArray(parsed.recurringMotifs),
      relationshipPatterns: asStringArray(parsed.relationshipPatterns),
      toneNotes: asStringArray(parsed.toneNotes),
      voiceNotes: asStringArray(parsed.voiceNotes),
      stanceNotes: asStringArray(parsed.stanceNotes),
      perspectiveNotes: asStringArray(parsed.perspectiveNotes),
      notes: asStringArray(parsed.notes),
      canonicalRenderings: parseCanonicalRenderings(parsed.canonicalRenderings),
    } satisfies ArtistProfileFile;
  } catch {
    return emptyProfile(artistKey);
  }
}

export async function writeArtistProfileFile(file: ArtistProfileFile) {
  const filePath = path.join(artistProfilesRoot, `${file.artistKey}.json`);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        ...file
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

export async function updateArtistProfileFile(
  artistKey: string,
  patch: Partial<ArtistProfileFields> & { displayName?: string | null }
) {
  const existing = await readArtistProfileFile(artistKey);
  const next: ArtistProfileFile = {
    ...existing,
    displayName: patch.displayName?.trim() || existing.displayName || artistKey,
    personaSummary:
      typeof patch.personaSummary === "string"
        ? patch.personaSummary.trim() || null
        : existing.personaSummary,
    translationPreferences: patch.translationPreferences ?? existing.translationPreferences,
    translationDirectives: patch.translationDirectives ?? existing.translationDirectives,
    recurringThemes: patch.recurringThemes ?? existing.recurringThemes,
    recurringMotifs: patch.recurringMotifs ?? existing.recurringMotifs,
    relationshipPatterns: patch.relationshipPatterns ?? existing.relationshipPatterns,
    toneNotes: patch.toneNotes ?? existing.toneNotes,
    voiceNotes: patch.voiceNotes ?? existing.voiceNotes,
    stanceNotes: patch.stanceNotes ?? existing.stanceNotes,
    perspectiveNotes: patch.perspectiveNotes ?? existing.perspectiveNotes,
    notes: patch.notes ?? existing.notes,
    canonicalRenderings: patch.canonicalRenderings ?? existing.canonicalRenderings ?? [],
    updatedAt: new Date().toISOString()
  };

  await writeArtistProfileFile(next);
  return next;
}
