import { type NextRequest, NextResponse } from "next/server";

import {
  readArtistProfileFile,
  updateArtistProfileFile
} from "@/features/ai/artist-profile-repository";
import { ensureArtistProfile } from "@/features/ai/artist-profile-generator";
import { readArtistGlossaryFile } from "@/features/ai/glossary-repository";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ artistKey: string }> };

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0)
    : [];
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await readSpotifySessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { artistKey } = await params;
  const [profile, glossaryFile] = await Promise.all([
    ensureArtistProfile(artistKey).catch(() => readArtistProfileFile(artistKey)),
    readArtistGlossaryFile(artistKey)
  ]);

  return NextResponse.json({
    success: true,
    ...profile,
    glossaryEntries: glossaryFile.entries
  });
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await readSpotifySessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { artistKey } = await params;
  const body = (await req.json()) as Record<string, unknown>;

  const updated = await updateArtistProfileFile(artistKey, {
    displayName: typeof body.displayName === "string" ? body.displayName : undefined,
    personaSummary: typeof body.personaSummary === "string" ? body.personaSummary : undefined,
    translationPreferences: normalizeStringArray(body.translationPreferences),
    translationDirectives: normalizeStringArray(body.translationDirectives),
    recurringThemes: normalizeStringArray(body.recurringThemes),
    recurringMotifs: normalizeStringArray(body.recurringMotifs),
    relationshipPatterns: normalizeStringArray(body.relationshipPatterns),
    toneNotes: normalizeStringArray(body.toneNotes),
    voiceNotes: normalizeStringArray(body.voiceNotes),
    stanceNotes: normalizeStringArray(body.stanceNotes),
    perspectiveNotes: normalizeStringArray(body.perspectiveNotes),
    notes: normalizeStringArray(body.notes)
  });

  const glossaryFile = await readArtistGlossaryFile(artistKey);

  return NextResponse.json({
    success: true,
    ...updated,
    glossaryEntries: glossaryFile.entries
  });
}
