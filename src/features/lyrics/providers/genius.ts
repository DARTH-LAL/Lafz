import type { LyricsCacheFile, LyricsLookupParams } from "@/features/lyrics/types";

const GENIUS_API_BASE = "https://api.genius.com";

type GeniusSearchHit = {
  type: string;
  result: {
    id: number;
    title: string;
    url: string;
    primary_artist: {
      name: string;
    };
  };
};

type GeniusSearchResponse = {
  response: {
    hits: GeniusSearchHit[];
  };
};

async function searchGenius(
  params: LyricsLookupParams,
  accessToken: string
): Promise<GeniusSearchHit["result"] | null> {
  const url = new URL(`${GENIUS_API_BASE}/search`);
  url.searchParams.set("q", `${params.title} ${params.artist}`);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "Lafz/0.1.0"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Genius search failed with status ${response.status}`);
  }

  const data = (await response.json()) as GeniusSearchResponse;
  const hits = data.response?.hits ?? [];

  // Take the first song hit — Genius search is generally well-ranked.
  const songHit = hits.find((h) => h.type === "song");
  return songHit?.result ?? null;
}

// Genius does not return lyrics text through the API — only a URL to the
// lyrics page. We fetch that page and extract the lyrics from the
// data-lyrics-container divs that Genius embeds in the HTML.
async function scrapeLyricsFromPage(pageUrl: string): Promise<string | null> {
  const response = await fetch(pageUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  return extractLyricsFromHtml(html);
}

function extractLyricsFromHtml(html: string): string | null {
  // Genius wraps each lyrics section in a div with data-lyrics-container="true".
  // We extract those, convert <br> tags to newlines, strip all remaining HTML
  // tags, and decode common HTML entities.
  const containerPattern = /data-lyrics-container="true"[^>]*>([\s\S]*?)<\/div>/g;

  const blocks: string[] = [];
  let match: RegExpExecArray | null;

  // eslint-disable-next-line no-cond-assign
  while ((match = containerPattern.exec(html)) !== null) {
    const rawBlock = match[1];

    if (!rawBlock) continue;

    const cleaned = rawBlock
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#x27;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
      .trim();

    if (cleaned) {
      blocks.push(cleaned);
    }
  }

  if (blocks.length === 0) {
    return null;
  }

  return blocks.join("\n\n").trim();
}

export async function fetchFromGenius(
  params: LyricsLookupParams,
  accessToken: string
): Promise<LyricsCacheFile | null> {
  const hit = await searchGenius(params, accessToken);

  if (!hit) {
    return null;
  }

  const lyrics = await scrapeLyricsFromPage(hit.url);

  if (!lyrics) {
    return null;
  }

  return {
    spotifyTrackId: params.spotifyTrackId,
    title: params.title,
    artist: params.artist,
    album: params.album,
    durationMs: params.durationMs,
    source: "genius",
    sourceLabel: "Genius",
    kind: "plain",
    language: null,
    fetchedAt: new Date().toISOString(),
    providerTrackId: String(hit.id),
    lines: [],
    plainLyrics: lyrics
  };
}
