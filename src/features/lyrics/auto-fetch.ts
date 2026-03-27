import { getGeniusAccessToken } from "@/lib/env";
import { fetchFromGenius } from "@/features/lyrics/providers/genius";
import { fetchFromLrclib } from "@/features/lyrics/providers/lrclib";
import { writeLyricsCacheFile } from "@/features/lyrics/repository";
import type { LyricsLookupParams } from "@/features/lyrics/types";

export type AutoFetchLyricsResult =
  | { status: "fetched_synced"; sourceLabel: string }
  | { status: "fetched_plain"; sourceLabel: string }
  | { status: "not_found" }
  | { status: "error"; message: string };

export async function autoFetchLyrics(params: LyricsLookupParams): Promise<AutoFetchLyricsResult> {
  // ── 1. lrclib (free, no key required, returns timed LRC when available) ──
  try {
    const lrclibResult = await fetchFromLrclib(params);

    if (lrclibResult) {
      await writeLyricsCacheFile(lrclibResult);
      return {
        status: lrclibResult.kind === "synced" ? "fetched_synced" : "fetched_plain",
        sourceLabel: lrclibResult.sourceLabel
      };
    }
  } catch (error) {
    // lrclib is best-effort — log and fall through to Genius.
    console.error("[auto-fetch] lrclib failed:", error instanceof Error ? error.message : error);
  }

  // ── 2. Genius fallback (plain lyrics only, requires GENIUS_ACCESS_TOKEN) ──
  const geniusToken = getGeniusAccessToken();

  if (geniusToken) {
    try {
      const geniusResult = await fetchFromGenius(params, geniusToken);

      if (geniusResult) {
        await writeLyricsCacheFile(geniusResult);
        return { status: "fetched_plain", sourceLabel: geniusResult.sourceLabel };
      }
    } catch (error) {
      console.error("[auto-fetch] Genius failed:", error instanceof Error ? error.message : error);
    }
  }

  return { status: "not_found" };
}
