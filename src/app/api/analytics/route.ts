import { NextRequest, NextResponse } from "next/server";
import { getUsageAnalytics } from "@/features/ai/usage-tracker";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const period = (request.nextUrl.searchParams.get("period") ?? "30d") as "24h" | "7d" | "30d" | "all";
  const data = await getUsageAnalytics(period);
  return NextResponse.json({ success: true, data });
}
