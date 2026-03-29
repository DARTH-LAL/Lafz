import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AiGlossaryEntry } from "@/features/ai/glossary";

// ── Paths ──────────────────────────────────────────────────────────────────

const artistsRoot = path.join(process.cwd(), "data", "ai", "glossaries", "local", "artists");

function artistGlossaryPath(artistKey: string) {
  return path.join(artistsRoot, `${artistKey}.json`);
}

function artistSuggestionsPath(artistKey: string) {
  return path.join(artistsRoot, `${artistKey}.suggestions.json`);
}

// ── Key normalisation ─────────────────────────────────────────────────────
// Extracts the PRIMARY artist only (before any comma, &, feat., ft., x)
// so collaborators and producers don't pollute the key.
// "Karan Aujla, Jay Track" → "karan-aujla"
// "AP Dhillon ft. Gurinder Gill" → "ap-dhillon"

export function normalizeArtistKey(artist: string): string {
  const primary = artist
    .split(/,|&| feat\.| ft\.| x /i)[0]
    .trim();
  const normalized = primary.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "unknown";
}

// ── Types ─────────────────────────────────────────────────────────────────

export type ArtistGlossaryFile = {
  displayName: string;
  artistKey: string;
  updatedAt: string;
  entries: AiGlossaryEntry[];
};

export type PendingGlossarySuggestion = AiGlossaryEntry & {
  reason: string;
  sourceSongId: string;
  suggestedAt: string;
};

// ── Artist glossary CRUD ──────────────────────────────────────────────────

export async function readArtistGlossaryFile(artistKey: string): Promise<ArtistGlossaryFile> {
  try {
    const text = await readFile(artistGlossaryPath(artistKey), "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as Record<string, unknown>).entries)
    ) {
      const file = parsed as ArtistGlossaryFile;
      return { displayName: file.displayName ?? artistKey, artistKey, updatedAt: file.updatedAt ?? new Date().toISOString(), entries: file.entries };
    }
    // Legacy: bare array
    if (Array.isArray(parsed)) {
      return { displayName: artistKey, artistKey, updatedAt: new Date().toISOString(), entries: parsed as AiGlossaryEntry[] };
    }
    return { displayName: artistKey, artistKey, updatedAt: new Date().toISOString(), entries: [] };
  } catch {
    return { displayName: artistKey, artistKey, updatedAt: new Date().toISOString(), entries: [] };
  }
}

async function writeArtistGlossaryFile(file: ArtistGlossaryFile): Promise<void> {
  await mkdir(artistsRoot, { recursive: true });
  await writeFile(artistGlossaryPath(file.artistKey), JSON.stringify(file, null, 2), "utf8");
}

export async function addOrUpdateGlossaryTerm(
  artistKey: string,
  displayName: string,
  entry: AiGlossaryEntry
): Promise<ArtistGlossaryFile> {
  const file = await readArtistGlossaryFile(artistKey);
  const idx = file.entries.findIndex((e) => e.term.trim().toLowerCase() === entry.term.trim().toLowerCase());
  if (idx >= 0) {
    file.entries[idx] = entry;
  } else {
    file.entries.push(entry);
  }
  file.displayName = displayName;
  file.artistKey = artistKey;
  file.updatedAt = new Date().toISOString();
  await writeArtistGlossaryFile(file);
  return file;
}

export async function deleteGlossaryTerm(artistKey: string, term: string): Promise<ArtistGlossaryFile> {
  const file = await readArtistGlossaryFile(artistKey);
  file.entries = file.entries.filter((e) => e.term.trim().toLowerCase() !== term.trim().toLowerCase());
  file.updatedAt = new Date().toISOString();
  await writeArtistGlossaryFile(file);
  return file;
}

// ── Term normalization for near-duplicate detection ───────────────────────
// Strips parenthetical content, takes the first variant before any "/" or "|",
// and collapses to lowercase alphanumeric tokens.
// "timepass / time-pass" → "timepass"
// "khayal rakhna / khayal rakhda" → "khayal rakhna"
// "pata mainu (de denga tu jaan)" → "pata mainu"

function normalizeTermForDedup(term: string): string {
  // Remove content in parentheses
  let s = term.replace(/\(.*?\)/g, "");
  // Take only the first segment before "/" or "|"
  s = s.split(/[/|]/)[0];
  // Lowercase, strip non-alphanumeric except spaces
  s = s.toLowerCase().replace(/[^a-z0-9\s]+/g, " ");
  // Collapse spaces
  return s.trim().replace(/\s+/g, " ");
}

// ── Pending suggestions ───────────────────────────────────────────────────

export async function readPendingSuggestions(artistKey: string): Promise<PendingGlossarySuggestion[]> {
  try {
    const text = await readFile(artistSuggestionsPath(artistKey), "utf8");
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed as PendingGlossarySuggestion[];
    return [];
  } catch {
    return [];
  }
}

async function writePendingSuggestions(artistKey: string, suggestions: PendingGlossarySuggestion[]): Promise<void> {
  await mkdir(artistsRoot, { recursive: true });
  await writeFile(artistSuggestionsPath(artistKey), JSON.stringify(suggestions, null, 2), "utf8");
}

export async function storePendingSuggestions(
  artistKey: string,
  incoming: PendingGlossarySuggestion[]
): Promise<void> {
  if (incoming.length === 0) return;
  const existing = await readPendingSuggestions(artistKey);
  // Normalize for near-duplicate detection (handles slash variants, parenthetical forms, etc.)
  const existingNormalized = new Set(existing.map((s) => normalizeTermForDedup(s.term)));
  // Also skip terms already in the main glossary
  const glossary = await readArtistGlossaryFile(artistKey);
  const glossaryNormalized = new Set(glossary.entries.map((e) => normalizeTermForDedup(e.term)));
  const toAdd = incoming.filter((s) => {
    const norm = normalizeTermForDedup(s.term);
    return !existingNormalized.has(norm) && !glossaryNormalized.has(norm);
  });
  if (toAdd.length === 0) return;
  await writePendingSuggestions(artistKey, [...existing, ...toAdd]);
}

export async function acceptSuggestion(artistKey: string, displayName: string, term: string): Promise<void> {
  const suggestions = await readPendingSuggestions(artistKey);
  const suggestion = suggestions.find((s) => s.term.toLowerCase() === term.toLowerCase());
  if (!suggestion) return;
  // Add to main glossary
  const { reason: _reason, sourceSongId: _src, suggestedAt: _at, ...entry } = suggestion;
  await addOrUpdateGlossaryTerm(artistKey, displayName, entry as AiGlossaryEntry);
  // Remove from suggestions
  await writePendingSuggestions(
    artistKey,
    suggestions.filter((s) => s.term.toLowerCase() !== term.toLowerCase())
  );
}

export async function dismissSuggestion(artistKey: string, term: string): Promise<void> {
  const suggestions = await readPendingSuggestions(artistKey);
  await writePendingSuggestions(
    artistKey,
    suggestions.filter((s) => s.term.toLowerCase() !== term.toLowerCase())
  );
}
