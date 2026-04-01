import { NextRequest, NextResponse } from "next/server";
import { getVocabularyAgentProcessStatus, runVocabularyAgentUntilIdle } from "@/features/brain/vocabulary-agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_MAX_JOBS = 3;
const MAX_ALLOWED_JOBS = 20;

function readSecretFromRequest(request: NextRequest) {
  const authorization = request.headers.get("authorization")?.trim();

  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  return request.headers.get("x-lafz-agent-secret")?.trim() ?? null;
}

function isAuthorized(request: NextRequest) {
  const expectedSecret = process.env.LAFZ_AGENT_RUNNER_SECRET?.trim();

  if (!expectedSecret) {
    return false;
  }

  return readSecretFromRequest(request) === expectedSecret;
}

function parseMaxJobs(value: unknown) {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_JOBS;
  }

  return Math.min(parsed, MAX_ALLOWED_JOBS);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const maxJobs = parseMaxJobs(body?.maxJobs);
  const workerId =
    (typeof body?.workerId === "string" && body.workerId.trim().length > 0 ? body.workerId.trim() : null) ??
    process.env.LAFZ_AGENT_WORKER_ID?.trim() ??
    `lafz-standalone-worker-${process.pid}`;

  const processed = await runVocabularyAgentUntilIdle({
    ignoreMode: true,
    workerId,
    reason: "remote",
    maxJobs
  });

  return NextResponse.json({
    ok: true,
    workerId,
    maxJobs,
    processedCount: processed.length,
    processed,
    status: getVocabularyAgentProcessStatus()
  });
}
