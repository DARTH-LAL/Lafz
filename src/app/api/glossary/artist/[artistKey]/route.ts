import { type NextRequest, NextResponse } from "next/server";

import type { AiGlossaryEntry } from "@/features/ai/glossary";
import {
  addOrUpdateGlossaryTerm,
  deleteGlossaryTerm,
  readArtistGlossaryFile,
} from "@/features/ai/glossary-repository";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ artistKey: string }> };

// GET /api/glossary/artist/[artistKey]
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await readSpotifySessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { artistKey } = await params;
  const file = await readArtistGlossaryFile(artistKey);
  return NextResponse.json({ success: true, ...file });
}

// POST /api/glossary/artist/[artistKey]  — add or update a term
// body: { displayName: string, entry: AiGlossaryEntry }
export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await readSpotifySessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { artistKey } = await params;
  const body = (await req.json()) as { displayName?: string; entry?: Record<string, unknown> };

  if (!body.entry || typeof body.entry.term !== "string" || typeof body.entry.meaning !== "string") {
    return NextResponse.json({ error: "entry.term and entry.meaning are required" }, { status: 400 });
  }

  const entry = {
    term: String(body.entry.term).trim(),
    meaning: String(body.entry.meaning).trim(),
    note: typeof body.entry.note === "string" && body.entry.note.trim() ? body.entry.note.trim() : undefined,
    category: ((body.entry.category as string | undefined) ?? "preferred_rendering") as AiGlossaryEntry["category"],
    aliases: Array.isArray(body.entry.aliases) ? (body.entry.aliases as string[]) : undefined,
  };

  const file = await addOrUpdateGlossaryTerm(artistKey, body.displayName ?? artistKey, entry);
  return NextResponse.json({ success: true, ...file });
}

// DELETE /api/glossary/artist/[artistKey]?term=...
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const session = await readSpotifySessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { artistKey } = await params;
  const term = req.nextUrl.searchParams.get("term");
  if (!term) return NextResponse.json({ error: "term query param required" }, { status: 400 });

  const file = await deleteGlossaryTerm(artistKey, term);
  return NextResponse.json({ success: true, ...file });
}
