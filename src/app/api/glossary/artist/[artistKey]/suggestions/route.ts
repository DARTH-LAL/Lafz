import { type NextRequest, NextResponse } from "next/server";

import {
  acceptSuggestion,
  dismissAllSuggestions,
  dismissSuggestion,
  readPendingSuggestions,
} from "@/features/ai/glossary-repository";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";

export const runtime = "nodejs";

type RouteParams = { params: Promise<{ artistKey: string }> };

// GET /api/glossary/artist/[artistKey]/suggestions
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await readSpotifySessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { artistKey } = await params;
  const suggestions = await readPendingSuggestions(artistKey);
  return NextResponse.json({ success: true, suggestions });
}

// POST /api/glossary/artist/[artistKey]/suggestions
// body: { action: "accept" | "dismiss", term: string, displayName?: string }
export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await readSpotifySessionFromCookies();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { artistKey } = await params;
  const body = (await req.json()) as { action?: string; term?: string; displayName?: string };

  if (!body.action || !body.term) {
    return NextResponse.json({ error: "action and term are required" }, { status: 400 });
  }

  if (body.action === "accept") {
    await acceptSuggestion(artistKey, body.displayName ?? artistKey, body.term);
  } else if (body.action === "dismiss") {
    await dismissSuggestion(artistKey, body.term);
  } else if (body.action === "dismiss_all") {
    await dismissAllSuggestions(artistKey);
  } else {
    return NextResponse.json({ error: "action must be accept, dismiss, or dismiss_all" }, { status: 400 });
  }

  const suggestions = await readPendingSuggestions(artistKey);
  return NextResponse.json({ success: true, suggestions });
}
