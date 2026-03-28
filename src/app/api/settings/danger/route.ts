import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { readdir, unlink, rm } from "node:fs/promises";
import path from "node:path";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATA_ROOT = path.join(process.cwd(), "data");

async function deleteFilesInDir(dir: string) {
  try {
    if (!fs.existsSync(dir)) return 0;
    const files = await readdir(dir);
    await Promise.all(files.map((f) => unlink(path.join(dir, f)).catch(() => {})));
    return files.length;
  } catch { return 0; }
}

export async function POST(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { action } = (await request.json().catch(() => ({}))) as { action?: string };

  switch (action) {
    case "clear-lyrics-cache": {
      const count = await deleteFilesInDir(path.join(DATA_ROOT, "lyrics", "cache"));
      return NextResponse.json({ success: true, message: `Cleared ${count} cached lyrics files.` });
    }
    case "delete-drafts": {
      const count = await deleteFilesInDir(path.join(DATA_ROOT, "translations", "drafts"));
      return NextResponse.json({ success: true, message: `Deleted ${count} AI draft files.` });
    }
    case "reset-analytics": {
      try {
        const usageFile = path.join(DATA_ROOT, "ai", "usage-runs.json");
        if (fs.existsSync(usageFile)) await unlink(usageFile);
      } catch {}
      return NextResponse.json({ success: true, message: "Analytics reset." });
    }
    case "wipe-all": {
      try { await rm(DATA_ROOT, { recursive: true, force: true }); } catch {}
      return NextResponse.json({ success: true, message: "All data wiped." });
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
