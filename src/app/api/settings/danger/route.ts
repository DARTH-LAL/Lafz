import { NextRequest, NextResponse } from "next/server";

import { clearAiUsageRuns } from "@/features/ai/usage-tracker";
import { deleteCloudDataJson, listCloudDataKeys } from "@/features/cloud/data-store";
import { getSupabaseServerClient } from "@/features/cloud/supabase";
import { readSpotifySessionFromRequest } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function deleteKeysUnder(prefix: string) {
  const keys = await listCloudDataKeys(prefix);
  await Promise.all(keys.map((key) => deleteCloudDataJson(key)));
  return keys.length;
}

async function wipeSupabaseCoreData() {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  await Promise.all([
    supabase.from("translation_drafts").delete().neq("spotify_track_id", ""),
    supabase.from("published_translations").delete().neq("spotify_track_id", ""),
    supabase.from("artist_profiles").delete().neq("artist_key", "")
  ]);
}

export async function POST(request: NextRequest) {
  const session = readSpotifySessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { action } = (await request.json().catch(() => ({}))) as { action?: string };

  switch (action) {
    case "clear-lyrics-cache": {
      const count = await deleteKeysUnder("data/lyrics/cache");
      return NextResponse.json({ success: true, message: `Cleared ${count} cached lyrics objects.` });
    }
    case "delete-drafts": {
      const count = await deleteKeysUnder("data/translations/drafts");
      const supabase = getSupabaseServerClient();
      if (supabase) {
        await supabase.from("translation_drafts").delete().neq("spotify_track_id", "");
      }
      return NextResponse.json({ success: true, message: `Deleted ${count} AI draft objects.` });
    }
    case "reset-analytics": {
      await clearAiUsageRuns();
      return NextResponse.json({ success: true, message: "Analytics reset." });
    }
    case "wipe-all": {
      const count = await deleteKeysUnder("data");
      await clearAiUsageRuns();
      await wipeSupabaseCoreData();
      return NextResponse.json({ success: true, message: `All cloud data wiped (${count} objects).` });
    }
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
