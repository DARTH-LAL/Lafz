import { NextRequest, NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/features/cloud/supabase";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const desktopCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type"
};

function withDesktopCors<T extends NextResponse>(response: T) {
  for (const [header, value] of Object.entries(desktopCorsHeaders)) {
    response.headers.set(header, value);
  }

  return response;
}

function normalizeHeader(value: string | null | undefined) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

function firstHeaderValue(value: string | null | undefined) {
  const header = normalizeHeader(value);
  if (!header) {
    return null;
  }

  return header.split(",")[0]?.trim() || null;
}

function getRequestIp(request: NextRequest) {
  return (
    firstHeaderValue(request.headers.get("cf-connecting-ip")) ||
    firstHeaderValue(request.headers.get("x-vercel-forwarded-for")) ||
    firstHeaderValue(request.headers.get("x-forwarded-for")) ||
    firstHeaderValue(request.headers.get("x-real-ip")) ||
    firstHeaderValue(request.headers.get("true-client-ip")) ||
    null
  );
}

function getRequestGeo(request: NextRequest) {
  const country = normalizeHeader(
    request.headers.get("cf-ipcountry") ||
    request.headers.get("x-vercel-ip-country") ||
    request.headers.get("x-country") ||
    request.headers.get("x-geo-country")
  );

  const city = normalizeHeader(
    request.headers.get("cf-city") ||
    request.headers.get("x-vercel-ip-city") ||
    request.headers.get("x-city") ||
    request.headers.get("x-geo-city")
  );

  return { country, city };
}

async function readRequestGeoBody(request: NextRequest) {
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== "object") {
      return { country: null, city: null };
    }

    const country = normalizeHeader(
      payload.country ||
      payload.last_seen_country ||
      payload.lastSeenCountry ||
      payload.geo?.country
    );

    const city = normalizeHeader(
      payload.city ||
      payload.last_seen_city ||
      payload.lastSeenCity ||
      payload.geo?.city
    );

    return { country, city };
  } catch {
    return { country: null, city: null };
  }
}

function shouldLookupIpGeo(request: NextRequest, geo: { country: string | null; city: string | null }) {
  if (geo.country || geo.city) {
    return false;
  }

  const host = normalizeHeader(request.headers.get("x-forwarded-host") || request.headers.get("host"));
  if (!host) {
    return true;
  }

  return !(
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("0.0.0.0") ||
    host.includes("127.0.0.1")
  );
}

async function lookupGeoFromIp(ip: string | null) {
  const cleanedIp = normalizeHeader(ip);
  if (!cleanedIp || cleanedIp === "127.0.0.1" || cleanedIp === "::1" || cleanedIp === "::ffff:127.0.0.1") {
    return { country: null, city: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    const response = await fetch(`https://ipapi.co/${encodeURIComponent(cleanedIp)}/json/`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      return { country: null, city: null };
    }

    const payload = await response.json().catch(() => null);
    const country = normalizeHeader(
      typeof payload?.country_name === "string" && payload.country_name.trim()
        ? payload.country_name
        : typeof payload?.country_code === "string"
          ? payload.country_code
          : null
    );
    const city = normalizeHeader(typeof payload?.city === "string" ? payload.city : null);

    return { country, city };
  } catch {
    return { country: null, city: null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function OPTIONS() {
  return withDesktopCors(new NextResponse(null, { status: 204 }));
}

export async function POST(request: NextRequest) {
  const authHeader = normalizeHeader(request.headers.get("authorization"));
  const accessToken = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice("bearer ".length).trim()
    : "";

  if (!accessToken) {
    return withDesktopCors(NextResponse.json({ error: "Missing access token." }, { status: 401 }));
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return withDesktopCors(NextResponse.json({ error: "Supabase is not configured." }, { status: 503 }));
  }

  const { data: userResult, error: userError } = await supabase.auth.getUser(accessToken);
  const user = userResult?.user ?? null;

  if (userError || !user?.id) {
    return withDesktopCors(NextResponse.json({ error: "Not authenticated." }, { status: 401 }));
  }

  const bodyGeo = await readRequestGeoBody(request);
  const requestGeo = bodyGeo.country || bodyGeo.city ? bodyGeo : getRequestGeo(request);
  const geo = shouldLookupIpGeo(request, requestGeo)
    ? await lookupGeoFromIp(getRequestIp(request))
    : requestGeo;
  const now = new Date().toISOString();

  const updatePayload: Record<string, string> = {
    id: user.id,
    email: user.email?.trim().toLowerCase() ?? "",
    last_seen_at: now,
    updated_at: now
  };

  if (geo.country) {
    updatePayload.last_seen_country = geo.country;
  }

  if (geo.city) {
    updatePayload.last_seen_city = geo.city;
  }

  const { data, error } = await supabase
    .from("lafz_app_profiles")
    .upsert(updatePayload, { onConflict: "id" })
    .select("id,email,last_seen_at,last_seen_country,last_seen_city,updated_at")
    .maybeSingle();

  if (error) {
    return withDesktopCors(NextResponse.json({ error: error.message }, { status: 500 }));
  }

  return withDesktopCors(NextResponse.json({
    success: true,
    profile: data ?? null
  }));
}
