import { NextRequest, NextResponse } from "next/server";

import { getAiGenerationJob } from "@/features/ai/job-store";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);

  if (!session) {
    return NextResponse.json({ success: false, error: "Spotify session expired." }, { status: 401 });
  }

  const jobId = request.nextUrl.searchParams.get("jobId")?.trim();

  if (!jobId) {
    return NextResponse.json({ success: false, error: "Missing jobId." }, { status: 400 });
  }

  const job = await getAiGenerationJob(jobId);

  if (!job) {
    return NextResponse.json({ success: false, error: "Draft generation job not found." }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    job
  });
}
