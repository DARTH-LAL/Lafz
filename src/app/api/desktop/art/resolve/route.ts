import { NextRequest, NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/features/cloud/supabase";
import { listLibraryPlaylistKeys, readLibraryPlaylistByKey } from "@/features/library/playlists-repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const desktopCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

function withDesktopCors<T extends NextResponse>(response: T) {
  for (const [header, value] of Object.entries(desktopCorsHeaders)) {
    response.headers.set(header, value);
  }

  return response;
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeLooseTitle(value: string) {
  return normalizeText(
    value
      .replace(/\((?:[^()]|\([^()]*\))*\)/g, " ")
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\s[-–—]\s.*$/, " ")
      .replace(/\b(?:feat|ft|featuring)\b.*$/i, " ")
  );
}

function normalizeArtistTokens(value: string) {
  return value
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bwith\b/gi)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function resolveMaybeRelativeUrl(value: string, baseUrl: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractMetaImageUrl(html: string, baseUrl: string) {
  const patterns = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image:secure_url["'][^>]*>/i,
    /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i,
    /<meta[^>]+name=["']twitter:image(?:\:src)?["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']twitter:image(?:\:src)?["'][^>]*>/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    const resolved = match?.[1] ? resolveMaybeRelativeUrl(match[1], baseUrl) : null;
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function extractYouTubeVideoId(externalUrl: string) {
  try {
    const url = new URL(externalUrl);
    const host = url.hostname.toLowerCase();

    if (host.includes("youtu.be")) {
      const pathId = url.pathname.split("/").filter(Boolean)[0] ?? "";
      return pathId.trim() || null;
    }

    if (host.includes("youtube.com")) {
      const watchId = url.searchParams.get("v")?.trim();
      if (watchId) {
        return watchId;
      }

      const shortsMatch = url.pathname.match(/\/shorts\/([^/]+)/i);
      if (shortsMatch?.[1]) {
        return shortsMatch[1].trim();
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function resolveBrowserArtworkUrl(externalUrl: string) {
  const trimmed = externalUrl.trim();

  if (!trimmed) {
    return null;
  }

  const videoId = extractYouTubeVideoId(trimmed);
  if (videoId) {
    return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`;
  }

  let response: Response;
  try {
    response = await fetch(trimmed, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "text/html,application/xhtml+xml"
      }
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const html = await response.text().catch(() => "");
  if (!html) {
    return null;
  }

  return extractMetaImageUrl(html, trimmed);
}

function trackMatches(
  track: { spotify_track_id: string; title: string; artist: string; album: string; album_art_url: string | null },
  target: { trackId: string; title: string; artist?: string | null; album: string }
) {
  if (target.trackId && track.spotify_track_id === target.trackId) {
    return true;
  }

  if (!target.title || !target.artist) {
    return false;
  }

  const normalizedTargetTitle = normalizeText(target.title);
  const normalizedTrackTitle = normalizeText(track.title);
  const looseTargetTitle = normalizeLooseTitle(target.title);
  const looseTrackTitle = normalizeLooseTitle(track.title);

  if (!normalizedTargetTitle || !normalizedTrackTitle) {
    return false;
  }

  const titleMatches = normalizedTargetTitle === normalizedTrackTitle || looseTargetTitle === looseTrackTitle;

  if (!titleMatches) {
    return false;
  }

  const targetArtist = normalizeText(target.artist ?? "");
  const trackArtist = normalizeText(track.artist);

  if (trackArtist === targetArtist) {
    if (!target.album) {
      return true;
    }

    const normalizedTargetAlbum = normalizeText(target.album);
    const normalizedTrackAlbum = normalizeText(track.album);

    return !normalizedTargetAlbum || !normalizedTrackAlbum || normalizedTargetAlbum === normalizedTrackAlbum;
  }

  const targetTokens = new Set(normalizeArtistTokens(target.artist));
  const overlap = normalizeArtistTokens(track.artist).filter((token) => targetTokens.has(token)).length;

  return overlap > 0;
}

export async function OPTIONS() {
  return withDesktopCors(new NextResponse(null, { status: 204 }));
}

export async function GET(request: NextRequest) {
  const trackId = request.nextUrl.searchParams.get("trackId")?.trim() ?? "";
  const title = request.nextUrl.searchParams.get("title")?.trim() ?? "";
  const artist = request.nextUrl.searchParams.get("artist")?.trim() ?? "";
  const album = request.nextUrl.searchParams.get("album")?.trim() ?? "";
  const externalUrl = request.nextUrl.searchParams.get("externalUrl")?.trim() ?? "";

  if (!trackId && !title) {
    return withDesktopCors(
      NextResponse.json({ error: "desktop album art lookup requires trackId or title." }, { status: 400 })
    );
  }

  const supabase = getSupabaseServerClient();

  if (supabase && trackId) {
    const { data, error } = await supabase
      .from("published_translations")
      .select("spotify_track_id, album_art_url")
      .eq("spotify_track_id", trackId)
      .maybeSingle();

    if (!error && typeof data?.album_art_url === "string" && data.album_art_url.trim().length > 0) {
      return withDesktopCors(
        NextResponse.json({
          albumArtUrl: data.album_art_url.trim(),
          source: "supabase"
        })
      );
    }
  }

  const keys = await listLibraryPlaylistKeys();

  for (const key of keys) {
    const playlist = await readLibraryPlaylistByKey(key).catch(() => null);

    if (!playlist || !Array.isArray(playlist.tracks)) {
      continue;
    }

    const matchingTrack = playlist.tracks.find((track) => {
      if (track.spotify_track_id === trackId && track.album_art_url) {
        return true;
      }

      if (!track.album_art_url) {
        return false;
      }

      return trackMatches(track, { trackId, title, artist: artist || null, album });
    });

    if (matchingTrack?.album_art_url) {
      return withDesktopCors(
        NextResponse.json({
          albumArtUrl: matchingTrack.album_art_url,
          source: "library"
        })
      );
    }
  }

  if (externalUrl) {
    const browserArtUrl = await resolveBrowserArtworkUrl(externalUrl).catch(() => null);
    if (browserArtUrl) {
      return withDesktopCors(
        NextResponse.json({
          albumArtUrl: browserArtUrl,
          source: "browser"
        })
      );
    }
  }

  return withDesktopCors(NextResponse.json({ albumArtUrl: null }, { status: 404 }));
}
