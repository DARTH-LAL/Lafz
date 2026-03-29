import { readFile } from "node:fs/promises";
import path from "node:path";

import { readArtistProfileFile, writeArtistProfileFile, hasArtistProfileContent } from "@/features/ai/artist-profile-repository";
import { requestOpenAiArtistProfile, isOpenAiConfigured } from "@/features/ai/openai";
import { listAiTranslationDraftsByArtistKey } from "@/features/ai/repository";
import { normalizeArtistKey, readArtistGlossaryFile } from "@/features/ai/glossary-repository";
import type { AiCorrectionExample, AiDraftLine } from "@/features/ai/types";

const artistMemoryRoot = path.join(process.cwd(), "data", "ai", "memory", "artists");
const MAX_EVIDENCE_SONGS = 6;
const MAX_EVIDENCE_LINES_PER_SONG = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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
      if (!original || !chosen) {
        return null;
      }

      return {
        original,
        chosen,
        note: asString(entry.note),
        updatedAt: asString(entry.updatedAt),
        useCount: typeof entry.useCount === "number" ? entry.useCount : null
      };
    })
    .filter((entry): entry is AiCorrectionExample => Boolean(entry));
}

async function readArtistCorrectionExamples(artistKey: string) {
  const filePath = path.join(artistMemoryRoot, `${artistKey}.json`);

  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return isRecord(parsed) ? parseCorrectionExamples(parsed.correctionExamples) : [];
  } catch {
    return [] satisfies AiCorrectionExample[];
  }
}

function scoreDraftLine(line: AiDraftLine) {
  let score = 0;

  if (line.selectorReason === "Manually reviewed in Lafz.") {
    score += 100;
  }

  if (line.confidence === "high") score += 30;
  if (line.confidence === "medium") score += 10;
  if (line.register) score += 8;
  if (line.note) score += 6;
  if (line.meaning) score += 6;
  if (line.impliedMeaning) score += 5;

  return score;
}

function pickEvidenceLines(lines: AiDraftLine[]) {
  return [...lines]
    .sort((left, right) => scoreDraftLine(right) - scoreDraftLine(left))
    .slice(0, MAX_EVIDENCE_LINES_PER_SONG)
    .map((line) => ({
      original: line.original,
      chosen: line.chosen,
      meaning: line.meaning,
      register: line.register,
      confidence: line.confidence,
      selectorReason: line.selectorReason
    }));
}

export async function ensureArtistProfile(artist: string | null) {
  const artistKey = artist ? normalizeArtistKey(artist) : null;

  if (!artistKey) {
    return null;
  }

  const [existingProfile, glossaryFile, drafts, correctionExamples] = await Promise.all([
    readArtistProfileFile(artistKey),
    readArtistGlossaryFile(artistKey),
    listAiTranslationDraftsByArtistKey(artistKey),
    readArtistCorrectionExamples(artistKey)
  ]);

  if (hasArtistProfileContent(existingProfile)) {
    return existingProfile;
  }

  const evidence = drafts
    .slice(0, MAX_EVIDENCE_SONGS)
    .map((draft) => ({
      spotifyTrackId: draft.spotifyTrackId,
      title: draft.title,
      album: draft.album,
      generatedAt: draft.generatedAt,
      songContext: draft.songContext,
      lines: pickEvidenceLines(draft.lines)
    }))
    .filter((entry) => entry.lines.length > 0);

  const hasEnoughEvidence =
    glossaryFile.entries.length > 0 || correctionExamples.length > 0 || evidence.length >= 2;

  if (!hasEnoughEvidence || !isOpenAiConfigured()) {
    return existingProfile;
  }

  const profileResponse = await requestOpenAiArtistProfile({
    artistKey,
    artistName: glossaryFile.displayName ?? existingProfile.displayName ?? artistKey,
    glossaryEntries: glossaryFile.entries,
    evidence: [
      ...evidence,
      ...(correctionExamples.length > 0
        ? [
            {
              spotifyTrackId: "artist-memory",
              title: "Manual corrections",
              album: "Lafz memory",
              generatedAt: new Date().toISOString(),
              songContext: null,
              lines: correctionExamples.slice(0, 10).map((entry) => ({
                original: entry.original,
                chosen: entry.chosen,
                meaning: entry.chosen,
                register: null,
                confidence: "high" as const,
                selectorReason: entry.note ?? "Learned from manual corrections"
              }))
            }
          ]
        : [])
    ]
  });

  const nextProfile = {
    artistKey,
    ...profileResponse.profile,
    displayName: profileResponse.profile.displayName || existingProfile.displayName || glossaryFile.displayName || artistKey,
    updatedAt: new Date().toISOString()
  };

  await writeArtistProfileFile(nextProfile);
  return nextProfile;
}
