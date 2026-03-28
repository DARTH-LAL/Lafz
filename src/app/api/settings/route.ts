import { NextRequest, NextResponse } from "next/server";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";
import { readSettings, writeSettings } from "@/features/settings/repository";
import type { LafzSettings } from "@/features/settings/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const settings = await readSettings();
  return NextResponse.json(settings);
}

export async function POST(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Partial<LafzSettings> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const current = await readSettings();
  const merged: LafzSettings = { ...current, ...body };
  await writeSettings(merged);
  return NextResponse.json({ success: true });
}
