import { redirect } from "next/navigation";

import { LibraryTrackDetail } from "@/components/library-track-detail";
import { isAiConfigured } from "@/features/ai/provider";
import { getAiTranslationDraftByTrackId } from "@/features/ai/repository";
import { getLibraryTrackRecord } from "@/features/library/queue";
import { inspectLyricsCache } from "@/features/lyrics/repository";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";
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

function getLyricsMessage(status: string | undefined) {
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
    return "Lafz generated an AI draft and kept it in untimed reading mode because the current lyrics do not have timestamps yet.";
  }

  if (status === "draft_only_preserved") {
    return "Lafz generated an AI draft and left your existing synced translation file untouched because overwrite was not enabled.";
  }

  if (status === "missing_ai_config") {
    return "Configure the Gemini translation pipeline before generating AI translation drafts.";
  }

  if (status === "missing_lyrics") {
    return "Import local lyrics for this track before asking Lafz to draft a translation.";
  }

  if (status === "provider_unavailable") {
    return detail ?? "Lafz could not reach one of the translation pipeline models right now. Check your model configuration and try again.";
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
  const lyricsStatus = getFirstParamValue(resolvedSearchParams.lyrics);
  const aiStatus = getFirstParamValue(resolvedSearchParams.ai);
  const aiDetail = getFirstParamValue(resolvedSearchParams.aiDetail);

  const [{ record }, translationInspection, lyricsInspection, aiDraft] = await Promise.all([
    getLibraryTrackRecord(spotifyTrackId),
    inspectTranslationFile(spotifyTrackId),
    inspectLyricsCache(spotifyTrackId),
    getAiTranslationDraftByTrackId(spotifyTrackId)
  ]);

  return (
    <LibraryTrackDetail
      record={record}
      translationInspection={translationInspection}
      lyricsInspection={lyricsInspection}
      aiDraft={aiDraft}
      aiConfigured={isAiConfigured()}
      lyricsStatus={lyricsStatus}
      lyricsMessage={getLyricsMessage(lyricsStatus)}
      aiStatus={aiStatus}
      aiMessage={getAiMessage(aiStatus, aiDetail)}
    />
  );
}
