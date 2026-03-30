import { NextRequest, NextResponse } from "next/server";

import { getCloudDataMetadata, isCloudStorageConfigurationError, listCloudDataKeys, readCloudDataJson } from "@/features/cloud/data-store";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DRAFTS_DIR = "data/translations/drafts";

type DraftLine = {
  order: number;
  original: string;
  chosen: string;
  selectorReason: string | null;
  selectionWinner?: "generator_a" | "generator_b" | "blended" | null;
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
    const keys = (await listCloudDataKeys(DRAFTS_DIR)).filter((key) => key.endsWith(".json"));
    const draftsWithTimes = await Promise.all(
      keys.map(async (key) => ({
        key,
        metadata: await getCloudDataMetadata(key)
      }))
    );

    const files = draftsWithTimes
      .sort((a, b) => {
        const left = a.metadata?.lastModifiedAt ? new Date(a.metadata.lastModifiedAt).getTime() : 0;
        const right = b.metadata?.lastModifiedAt ? new Date(b.metadata.lastModifiedAt).getTime() : 0;
        return right - left;
      })
      .slice(0, 5);

    const items: Array<{
      winner: string;
      original: string;
      chosen: string;
      reason: string;
      track: string;
      lineIndex: number;
    }> = [];

    for (const { key } of files) {
      if (items.length >= 6) break;
      try {
        const draft = await readCloudDataJson<DraftFile>(key);
        if (!draft) continue;
        const trackLabel = draft.title ?? key.split("/").pop()?.replace(".json", "") ?? "Unknown track";

        const withReason = draft.lines
          .filter((line) => line.selectorReason != null && line.selectorReason.trim().length > 0)
          .slice(0, 6 - items.length);

        for (const line of withReason) {
          items.push({
            winner: line.selectionWinner ?? "blended",
            original: line.original ?? "",
            chosen: line.chosen ?? "",
            reason: line.selectorReason ?? "",
            track: trackLabel,
            lineIndex: (line.order ?? 0) + 1
          });
        }
      } catch {
        // skip malformed drafts
      }
    }

    return NextResponse.json({ items });
    } catch (error) {
      if (isCloudStorageConfigurationError(error)) {
        throw error;
      }
      return NextResponse.json({ items: [] });
    }
}
