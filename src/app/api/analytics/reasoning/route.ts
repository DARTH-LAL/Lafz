import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DRAFTS_DIR = path.join(process.cwd(), "data", "translations", "drafts");

type DraftLine = {
  order: number;
  original: string;
  chosen: string;
  selectorReason: string | null;
  confidence?: string;
};

type DraftFile = {
  title: string;
  artist: string;
  generatedAt: string;
  lines: DraftLine[];
};

export async function GET(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    if (!fs.existsSync(DRAFTS_DIR)) {
      return NextResponse.json({ items: [] });
    }

    const files = fs.readdirSync(DRAFTS_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        const fullPath = path.join(DRAFTS_DIR, f);
        const stat = fs.statSync(fullPath);
        return { file: f, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 5);

    const items: Array<{
      winner: string;
      original: string;
      chosen: string;
      reason: string;
      track: string;
      lineIndex: number;
    }> = [];

    for (const { file } of files) {
      if (items.length >= 6) break;
      try {
        const content = fs.readFileSync(path.join(DRAFTS_DIR, file), "utf-8");
        const draft = JSON.parse(content) as DraftFile;
        const trackLabel = draft.title ?? file.replace(".json", "");

        const withReason = draft.lines
          .filter(l => l.selectorReason != null && l.selectorReason.trim().length > 0)
          .slice(0, 6 - items.length);

        for (const line of withReason) {
          items.push({
            winner: "generator_a", // default since we don't store winner per line in draft
            original: line.original ?? "",
            chosen: line.chosen ?? "",
            reason: line.selectorReason ?? "",
            track: trackLabel,
            lineIndex: (line.order ?? 0) + 1
          });
        }
      } catch {
        // skip malformed files
      }
    }

    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
