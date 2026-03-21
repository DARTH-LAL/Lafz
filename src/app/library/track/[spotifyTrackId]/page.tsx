import { redirect } from "next/navigation";

import { LibraryTrackDetail } from "@/components/library-track-detail";
import { getActiveAiModel, inspectAiProviderStatus, isAiConfigured } from "@/features/ai/provider";
import { getAiTranslationDraftByTrackId, inspectAiTranslationDraftFile } from "@/features/ai/repository";
import { getLibraryTrackRecord } from "@/features/library/queue";
import { getLyricsCacheByTrackId, inspectLyricsCache } from "@/features/lyrics/repository";
import { isMusixmatchConfigured } from "@/features/lyrics/musixmatch";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";
import { buildTimingEditorDocument } from "@/features/timing/editor";
import { getTranslationByTrackId } from "@/features/translations/repository";
import { inspectTranslationFile } from "@/features/translations/inspection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LibraryTrackPageProps = {
  params: Promise<{
    spotifyTrackId: string;
  }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getFirstParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function getStubMessage(status: string | undefined) {
  if (status === "created") {
    return "Lafz created a new local translation stub file for this track.";
  }

  if (status === "exists") {
    return "A local translation file already exists for this track, so Lafz left it unchanged.";
  }

  if (status === "error") {
    return "Lafz could not create the stub file for this track. Check the server console and local file permissions.";
  }

  return null;
}

function getLyricsMessage(status: string | undefined) {
  if (status === "official_fetched") {
    return "Lafz fetched original lyrics from the official provider and cached them locally.";
  }

  if (status === "official_not_found") {
    return "The official provider did not return lyrics for this track. Use the local import fallback below.";
  }

  if (status === "official_missing_provider") {
    return "Set MUSIXMATCH_API_KEY in .env.local before fetching official lyrics.";
  }

  if (status === "official_error") {
    return "Lafz could not fetch lyrics from the official provider right now. Try again or use the local import fallback.";
  }

  if (status === "local_imported") {
    return "Lafz saved your local lyrics import into the local cache for this track.";
  }

  if (status === "local_error") {
    return "Lafz could not import the local lyrics text. Paste valid LRC, synced JSON, or plain lyric text and try again.";
  }

  return null;
}

function getAiMessage(status: string | undefined, detail: string | undefined) {
  if (status === "saved_translation") {
    return "Lafz generated an AI draft and wrote a synced translation JSON file you can use in playback immediately.";
  }

  if (status === "draft_only_plain") {
    return "Lafz generated an AI draft and saved it locally, but the current original lyrics cache has no timestamps yet, so the synced translation file was left alone.";
  }

  if (status === "draft_only_preserved") {
    return "Lafz generated an AI draft but preserved your existing translation file because overwrite was not enabled.";
  }

  if (status === "missing_ai_config") {
    return "Configure the active AI provider before generating AI translation drafts.";
  }

  if (status === "missing_lyrics") {
    return "Fetch official lyrics or import a local lyrics fallback before asking Lafz to draft a translation.";
  }

  if (status === "provider_unavailable") {
    return detail ?? "Lafz could not reach the active AI provider right now. Check your local or remote AI settings and try again.";
  }

  if (status === "model_missing") {
    return detail ?? "The selected AI model is not available yet. Update the configured model, then try again.";
  }

  if (status === "error") {
    return detail ?? "Lafz could not generate the AI translation draft right now. Check the server logs, then try again.";
  }

  return null;
}

export default async function LibraryTrackPage({ params, searchParams }: LibraryTrackPageProps) {
  const session = await readSpotifySessionFromCookies();

  if (!session) {
    redirect("/login");
  }

  const { spotifyTrackId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const stubStatus = getFirstParamValue(resolvedSearchParams.stub);
  const lyricsStatus = getFirstParamValue(resolvedSearchParams.lyrics);
  const aiStatus = getFirstParamValue(resolvedSearchParams.ai);
  const aiDetail = getFirstParamValue(resolvedSearchParams.aiDetail);

  const [{ record }, translationInspection, lyricsInspection, aiDraftInspection, aiProviderStatus, translation, aiDraft, lyricsCache] = await Promise.all([
    getLibraryTrackRecord(spotifyTrackId),
    inspectTranslationFile(spotifyTrackId),
    inspectLyricsCache(spotifyTrackId),
    inspectAiTranslationDraftFile(spotifyTrackId),
    inspectAiProviderStatus(),
    getTranslationByTrackId(spotifyTrackId),
    getAiTranslationDraftByTrackId(spotifyTrackId),
    getLyricsCacheByTrackId(spotifyTrackId)
  ]);

  const timingEditorDocument = record
    ? buildTimingEditorDocument({
        spotifyTrackId: record.spotify_track_id,
        title: record.title,
        artist: record.artist,
        album: record.album,
        durationMs: record.duration_ms,
        translation,
        aiDraft,
        lyricsCache
      })
    : null;

  return (
    <LibraryTrackDetail
      record={record}
      translationInspection={translationInspection}
      lyricsInspection={lyricsInspection}
      aiDraft={aiDraft}
      aiDraftInspection={aiDraftInspection}
      timingEditorDocument={timingEditorDocument}
      musixmatchConfigured={isMusixmatchConfigured()}
      aiConfigured={isAiConfigured()}
      aiModel={getActiveAiModel()}
      aiProviderStatus={aiProviderStatus}
      stubStatus={stubStatus === "created" || stubStatus === "exists" || stubStatus === "error" ? stubStatus : null}
      stubMessage={getStubMessage(stubStatus)}
      lyricsStatus={lyricsStatus}
      lyricsMessage={getLyricsMessage(lyricsStatus)}
      aiStatus={aiStatus}
      aiMessage={getAiMessage(aiStatus, aiDetail)}
    />
  );
}
