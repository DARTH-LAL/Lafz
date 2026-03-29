import { type NextRequest, NextResponse } from "next/server";

import {
  readArtistProfileFile,
  updateArtistProfileFile,
  writeArtistProfileFile
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

export async function GET(req: NextRequest, { params }: RouteParams) {
  const session = await readSpotifySessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { artistKey } = await params;
  const forceRefresh = req.nextUrl.searchParams.get("refresh") === "true";

  // If force-refresh requested, wipe the profile first so ensureArtistProfile rebuilds it
  if (forceRefresh) {
    const blank = await readArtistProfileFile(artistKey);
    await writeArtistProfileFile({
      ...blank,
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
      updatedAt: new Date(0).toISOString(), // epoch so staleness check always passes
    });
  }

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
    notes: normalizeStringArray(body.notes),
    ...(Array.isArray(body.canonicalRenderings)
      ? {
          canonicalRenderings: (body.canonicalRenderings as unknown[])
            .filter(
              (r): r is { term: string; rendering: string; note?: string } =>
                typeof r === "object" && r !== null &&
                typeof (r as Record<string, unknown>).term === "string" &&
                typeof (r as Record<string, unknown>).rendering === "string"
            )
            .map((r) => ({
              term: r.term.trim(),
              rendering: r.rendering.trim(),
              ...(r.note?.trim() ? { note: r.note.trim() } : {}),
            })),
        }
      : {}),
  });

  const glossaryFile = await readArtistGlossaryFile(artistKey);

  return NextResponse.json({
    success: true,
    ...updated,
    glossaryEntries: glossaryFile.entries
  });
}
