import { AiDraftWorkspace } from "@/components/ai-draft-workspace";
import { AppTopBar } from "@/components/app-top-bar";
import { LyricsImportForm } from "@/components/lyrics-import-form";
import { StatePanel } from "@/components/state-panel";
import type { AiProviderStatus, AiTranslationDraftFile, AiTranslationDraftInspection } from "@/features/ai/types";
import type { LyricsCacheInspection } from "@/features/lyrics/types";
import { TranslationStatusBadge } from "@/components/translation-status-badge";
import type { LibraryQueueRecord } from "@/features/library/types";
import type { TranslationFileInspection } from "@/features/translations/types";
import { formatMilliseconds } from "@/lib/utils";

function formatUpdatedAt(value: string | null) {
  if (!value) {
    return "Not updated yet";
  }

  return new Date(value).toLocaleString();
}

type LibraryTrackDetailProps = {
  record: LibraryQueueRecord | null;
  translationInspection: TranslationFileInspection;
  lyricsInspection: LyricsCacheInspection;
  aiDraft: AiTranslationDraftFile | null;
  aiDraftInspection: AiTranslationDraftInspection;
  aiProviderStatus: AiProviderStatus;
  aiConfigured: boolean;
  aiModel: string;
  lyricsStatus: string;
  lyricsMessage: string | null;
  aiStatus: string;
  aiMessage: string | null;
};

export function LibraryTrackDetail({
  record,
  translationInspection,
  lyricsInspection,
  aiDraft,
  aiDraftInspection,
  aiProviderStatus,
  aiConfigured,
  aiModel,
  lyricsStatus,
  lyricsMessage,
  aiStatus,
  aiMessage
}: LibraryTrackDetailProps) {
  if (!record) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-8 lg:px-10">
        <AppTopBar connected className="mb-8" />

        <StatePanel
          eyebrow="Track missing"
          title="Lafz could not find that track in the imported library"
          description="Import a playlist containing this song first, then return to the queue to inspect it."
        />
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-8 lg:px-10">
      <AppTopBar connected className="mb-8" />

      <header className="mb-8 flex flex-col gap-4 border-b border-white/8 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#ff6ba8]/80">Lafz track detail</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            {record.title}
          </h1>
          <p className="mt-3 text-lg text-slate-300">{record.artist}</p>
          <p className="mt-2 text-sm text-slate-500">{record.album}</p>
        </div>

        <div className="flex flex-wrap gap-3">
          {record.spotify_track_url ? (
            <a
              href={record.spotify_track_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-full border border-[rgba(255,45,120,0.2)] bg-[rgba(255,45,120,0.09)] px-5 py-3 text-sm font-semibold text-[#fff0f6] transition hover:bg-[rgba(255,45,120,0.14)]"
            >
              Open on Spotify
            </a>
          ) : null}
        </div>
      </header>

      {lyricsMessage ? (
        <div
          className={`mb-6 rounded-[24px] px-5 py-4 text-sm ${
            lyricsStatus === "local_error"
              ? "border border-amber-300/20 bg-amber-300/10 text-amber-100"
              : "border border-[rgba(255,45,120,0.2)] bg-[rgba(255,45,120,0.09)] text-[#fff0f6]"
          }`}
        >
          {lyricsMessage}
        </div>
      ) : null}

      {aiMessage ? (
        <div
          className={`mb-6 rounded-[24px] px-5 py-4 text-sm ${
            aiStatus === "error" || aiStatus === "provider_unavailable" || aiStatus === "model_missing"
              ? "border border-amber-300/20 bg-amber-300/10 text-amber-100"
              : "border border-[rgba(255,45,120,0.2)] bg-[rgba(255,45,120,0.09)] text-[#fff0f6]"
          }`}
        >
          {aiMessage}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(320px,380px)_1fr] lg:items-start">
        <section className="rounded-[32px] border border-white/10 bg-[color:var(--lafz-panel-strong)] p-6 shadow-[0_24px_100px_rgba(0,0,0,0.3)] backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <TranslationStatusBadge status={record.studio_status} />
            <span className="text-xs uppercase tracking-[0.22em] text-slate-500">
              Library status: {record.explicit_translation_status ?? "pending"}
            </span>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-400">{record.studio_status_reason}</p>

          <div className="mt-6 space-y-4 text-sm text-slate-300">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Spotify track ID</p>
              <p className="mt-2 break-all font-mono text-xs text-slate-200">{record.spotify_track_id}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Language</p>
              <p className="mt-2 text-base text-white">{record.language}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Duration</p>
              <p className="mt-2 text-base text-white">{formatMilliseconds(record.duration_ms)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Translation file</p>
              <p className="mt-2 text-base text-white">{translationInspection.exists ? "Present" : "Missing"}</p>
              <p className="mt-2 break-all font-mono text-xs text-slate-400">{translationInspection.filePath}</p>
              {!translationInspection.exists ? (
                <p className="mt-2 text-xs leading-6 text-slate-400">
                  Lafz now auto-creates this file during playlist and single-song imports. If it is missing here, the song
                  was likely imported before that change or the file was removed locally.
                </p>
              ) : null}
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Line count</p>
              <p className="mt-2 text-base text-white">{translationInspection.lineCount}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Last modified</p>
              <p className="mt-2 text-base text-white">{formatUpdatedAt(translationInspection.lastModifiedAt)}</p>
            </div>
          </div>

          <div className="mt-6">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Source playlists</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {record.source_playlists.map((playlist) => (
                <span
                  key={`${record.spotify_track_id}-${playlist.playlist_id}`}
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300"
                >
                  {playlist.playlist_name}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-white/10 bg-[color:var(--lafz-panel)] p-6 shadow-[0_24px_100px_rgba(0,0,0,0.3)] backdrop-blur-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#ff6ba8]/80">Translation JSON preview</p>

          {translationInspection.lineCount === 0 && aiDraftInspection.exists ? (
            <div className="mt-5 rounded-[22px] border border-[rgba(255,45,120,0.2)] bg-[rgba(255,45,120,0.09)] p-4 text-sm leading-7 text-[#fff0f6]">
              {aiDraftInspection.mode === "synced"
                ? "Lafz found a synced AI draft for this track. Playback can use those timings immediately, and generating the draft again will also recreate the local translation file if it is missing."
                : "Lafz found an untimed AI draft for this track. Because the lyrics do not have timestamps, playback stays in plain reading mode instead of karaoke-style synced mode."}
            </div>
          ) : null}

          {translationInspection.exists ? (
            <>
              {translationInspection.parseError ? (
                <div className="mt-5 rounded-[22px] border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
                  Lafz found a translation file, but it could not be parsed cleanly: {translationInspection.parseError}
                </div>
              ) : null}
              <pre className="mt-5 max-h-[70vh] overflow-auto rounded-[24px] border border-white/8 bg-black/25 p-5 text-xs leading-6 text-slate-200">
                {translationInspection.preview}
              </pre>
            </>
          ) : (
            <StatePanel
              eyebrow="No translation yet"
              title="This song does not have a local translation file yet"
              description="If the lyrics for this track are synced, generating an AI draft will automatically build a playback-ready translation. If the lyrics are untimed, Lafz will still show the draft in plain reading mode."
              className="mt-5 border-white/8 bg-white/[0.03] shadow-none"
            />
          )}
        </section>
      </div>

      <section className="mt-6 rounded-[32px] border border-white/10 bg-[color:var(--lafz-panel)] p-6 shadow-[0_24px_100px_rgba(0,0,0,0.3)] backdrop-blur-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#ff6ba8]/80">Original lyrics input</p>
        <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white">
          Paste local LRC, JSON, or plain lyrics.
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-300">
          Lyrics are fetched automatically on import. If the auto-fetch missed this track, paste them manually here.
        </p>

        <LyricsImportForm
          track={{
            spotifyTrackId: record.spotify_track_id,
            title: record.title,
            artist: record.artist,
            album: record.album,
            durationMs: record.duration_ms
          }}
          initialMessage={lyricsMessage}
          initialStatus={lyricsStatus}
        />
      </section>

      <section className="mt-6 rounded-[32px] border border-white/10 bg-[color:var(--lafz-panel)] p-6 shadow-[0_24px_100px_rgba(0,0,0,0.3)] backdrop-blur-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#ff6ba8]/80">Original lyrics cache</p>

        {lyricsInspection.exists ? (
          <>
            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[22px] border border-white/8 bg-black/10 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Source</p>
                <p className="mt-2 text-base text-white">{lyricsInspection.sourceLabel ?? "Unknown source"}</p>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-black/10 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Kind</p>
                <p className="mt-2 text-base capitalize text-white">{lyricsInspection.kind}</p>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-black/10 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Synced lines</p>
                <p className="mt-2 text-base text-white">{lyricsInspection.lineCount}</p>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-black/10 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Last modified</p>
                <p className="mt-2 text-base text-white">{formatUpdatedAt(lyricsInspection.lastModifiedAt)}</p>
              </div>
            </div>

            {lyricsInspection.parseError ? (
              <div className="mt-5 rounded-[22px] border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
                Lafz found a lyrics cache file, but it could not be parsed cleanly: {lyricsInspection.parseError}
              </div>
            ) : null}

            <div className="mt-5 rounded-[22px] border border-dashed border-white/12 bg-black/10 p-4 text-sm text-slate-300">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Local cache path</p>
              <p className="mt-2 break-all font-mono text-xs text-slate-200">{lyricsInspection.filePath}</p>
            </div>

            <pre className="mt-5 max-h-[70vh] overflow-auto rounded-[24px] border border-white/8 bg-black/25 p-5 text-xs leading-6 text-slate-200">
              {lyricsInspection.preview}
            </pre>
          </>
        ) : (
          <StatePanel
            eyebrow="No cached lyrics yet"
            title="Import local lyrics to start translating"
            description="Lafz keeps original lyrics in a local gitignored cache file so you can use them without storing the content in the repo."
            className="mt-5 border-white/8 bg-white/[0.03] shadow-none"
          />
        )}
      </section>

      <AiDraftWorkspace
        track={{
          spotifyTrackId: record.spotify_track_id,
          title: record.title,
          artist: record.artist,
          album: record.album,
          durationMs: record.duration_ms,
          defaultSourceLanguage: record.language
        }}
        lyricsKind={lyricsInspection.kind}
        lyricsLanguage={lyricsInspection.language}
        translationKind={translationInspection.kind}
        aiConfigured={aiConfigured}
        aiModel={aiModel}
        aiProviderStatus={aiProviderStatus}
        initialDraft={aiDraft}
        initialInspection={aiDraftInspection}
        initialMessage={aiMessage}
        initialStatus={aiStatus}
      />
    </main>
  );
}
