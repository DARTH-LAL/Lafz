import { AiDraftWorkspace } from "@/components/ai-draft-workspace";
import { AppTopBar } from "@/components/app-top-bar";
import { GenerationHistory } from "@/components/generation-history";
import { StatePanel } from "@/components/state-panel";
import type { AiProviderStatus, AiTranslationDraftFile, AiTranslationDraftInspection } from "@/features/ai/types";
import type { LyricsCacheInspection } from "@/features/lyrics/types";
import { TranslationStatusBadge } from "@/components/translation-status-badge";
import type { LibraryQueueRecord } from "@/features/library/types";
import type { TranslationFileInspection } from "@/features/translations/types";
import { formatMilliseconds } from "@/lib/utils";

function formatUpdatedAt(value: string | null) {
  if (!value) return "Not updated yet";
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
      <main className="relative min-h-screen w-full overflow-x-hidden bg-[#060410] text-[#fff0f6]">
        <div className="pointer-events-none fixed inset-0 z-0">
          <div className="absolute -right-40 -top-40 h-[700px] w-[700px] rounded-full bg-[radial-gradient(circle,rgba(255,20,100,0.18)_0%,transparent_60%)]" />
          <div className="absolute -left-28 bottom-0 h-[450px] w-[500px] rounded-full bg-[radial-gradient(ellipse,rgba(160,20,255,0.10)_0%,transparent_65%)]" />
        </div>
        <div
          className="pointer-events-none fixed inset-0 z-0"
          style={{
            backgroundImage: "radial-gradient(rgba(255,20,100,0.10) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
            maskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%)",
            WebkitMaskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%)"
          }}
        />
        <div className="relative z-10 mx-auto max-w-6xl px-6 py-8 lg:px-10">
          <AppTopBar connected className="mb-8" />
          <StatePanel
            eyebrow="Track missing"
            title="Lafz could not find that track in the imported library"
            description="Import a playlist containing this song first, then return to the queue to inspect it."
          />
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen w-full overflow-x-hidden bg-[#060410] text-[#fff0f6]">

      {/* Background glows */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -right-40 -top-40 h-[700px] w-[700px] rounded-full bg-[radial-gradient(circle,rgba(255,20,100,0.18)_0%,transparent_60%)]" />
        <div className="absolute -left-28 bottom-0 h-[450px] w-[500px] rounded-full bg-[radial-gradient(ellipse,rgba(160,20,255,0.10)_0%,transparent_65%)]" />
      </div>

      {/* Dot grid */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: "radial-gradient(rgba(255,20,100,0.10) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%)"
        }}
      />

      <div className="relative z-10 mx-auto max-w-6xl px-6 py-8 lg:px-10">
        <AppTopBar connected className="mb-8" />

        {/* Header */}
        <header className="mb-10">
          <div className="mb-4 flex items-center gap-3">
            <div className="h-0.5 w-7 rounded-full bg-[linear-gradient(90deg,#ff1464,transparent)] shadow-[0_0_8px_#ff1464]" />
            <p className="text-[11px] font-bold uppercase tracking-[2.5px] text-[#ff1464] [text-shadow:0_0_16px_rgba(255,20,100,0.6)]">
              Lafz Track Detail
            </p>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="font-display text-5xl font-extrabold leading-[1.02] tracking-[-3px]">
                {record.title}
              </h1>
              <p className="mt-3 text-[18px] text-[#c8b8d8]">{record.artist}</p>
              <p className="mt-1 text-[13px] text-[#5a4870]">{record.album}</p>
            </div>

            {record.spotify_track_url ? (
              <a
                href={record.spotify_track_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,20,100,0.25)] bg-[rgba(255,20,100,0.10)] px-5 py-2.5 text-[13px] font-semibold text-[#ff6aaa] transition hover:bg-[rgba(255,20,100,0.20)] hover:shadow-[0_0_20px_rgba(255,20,100,0.25)] hover:text-[#fff0f6]"
              >
                <span>♫</span> Open on Spotify
              </a>
            ) : null}
          </div>

          <div className="relative mt-8 h-px w-full">
            <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(255,20,100,0.5)_30%,rgba(255,20,100,0.8)_50%,rgba(255,20,100,0.5)_70%,transparent)]" />
            <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ff1464] shadow-[0_0_12px_#ff1464,0_0_24px_rgba(255,20,100,0.6)]" />
          </div>
        </header>

        {/* Status banners */}
        {lyricsMessage ? (
          <div
            className={`mb-6 rounded-[16px] px-5 py-4 text-[13px] ${
              lyricsStatus === "local_error"
                ? "border border-[rgba(255,160,30,0.20)] bg-[rgba(255,160,30,0.08)] text-[#ffc87a]"
                : "border border-[rgba(255,20,100,0.20)] bg-[rgba(255,20,100,0.08)] text-[#ff6aaa]"
            }`}
          >
            {lyricsMessage}
          </div>
        ) : null}

        {aiMessage ? (
          <div
            className={`mb-6 rounded-[16px] px-5 py-4 text-[13px] ${
              aiStatus === "error" || aiStatus === "provider_unavailable" || aiStatus === "model_missing"
                ? "border border-[rgba(255,160,30,0.20)] bg-[rgba(255,160,30,0.08)] text-[#ffc87a]"
                : "border border-[rgba(255,20,100,0.20)] bg-[rgba(255,20,100,0.08)] text-[#ff6aaa]"
            }`}
          >
            {aiMessage}
          </div>
        ) : null}

        {/* Info card */}
        <section className="mb-6 rounded-[24px] border border-[rgba(255,20,100,0.16)] bg-[rgba(10,7,22,0.90)] p-6 shadow-[0_0_60px_rgba(255,20,100,0.05)] backdrop-blur-[24px]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <TranslationStatusBadge status={record.studio_status} />
              <span className="text-[11px] uppercase tracking-[0.22em] text-[#5a4870]">
                {record.explicit_translation_status ?? "pending"}
              </span>
            </div>

            {translationInspection.exists ? (
              <a
                href={`/api/translation/${record.spotify_track_id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,20,100,0.22)] bg-[rgba(255,20,100,0.08)] px-4 py-2 text-[12px] font-semibold text-[#ff6aaa] transition hover:bg-[rgba(255,20,100,0.16)] hover:text-[#fff0f6]"
              >
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                  <polyline points="15 3 21 3 21 9"/>
                  <line x1="10" y1="14" x2="21" y2="3"/>
                </svg>
                View translation file
              </a>
            ) : null}
          </div>

          {record.studio_status_reason ? (
            <p className="mt-4 border-b border-[rgba(255,20,100,0.08)] pb-4 text-[13px] leading-[1.65] text-[#7a6890]">
              {record.studio_status_reason}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-6">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[2px] text-[rgba(255,20,100,0.55)]">Language</p>
              <p className="mt-1 text-[15px] font-semibold text-[#fff0f6]">{record.language}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[2px] text-[rgba(255,20,100,0.55)]">Duration</p>
              <p className="mt-1 text-[15px] font-semibold text-[#fff0f6]">{formatMilliseconds(record.duration_ms)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[2px] text-[rgba(255,20,100,0.55)]">Translation file</p>
              <p className="mt-1 text-[15px] font-semibold text-[#fff0f6]">{translationInspection.exists ? "Present" : "Missing"}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[2px] text-[rgba(255,20,100,0.55)]">Source playlists</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {record.source_playlists.map((playlist) => (
                  <span
                    key={`${record.spotify_track_id}-${playlist.playlist_id}`}
                    className="rounded-full border border-[rgba(255,20,100,0.18)] bg-[rgba(255,20,100,0.07)] px-3 py-1 text-[12px] text-[#ff6aaa]"
                  >
                    {playlist.playlist_name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Lyrics cache */}
        <section className="mb-6 rounded-[24px] border border-[rgba(255,20,100,0.12)] bg-[rgba(10,7,22,0.75)] p-6 backdrop-blur-[20px]">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-[2.2px] text-[rgba(255,20,100,0.65)]">Original lyrics cache</p>

          {lyricsInspection.exists ? (
            <>
              <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[16px] border border-[rgba(200,126,255,0.18)] bg-[rgba(200,126,255,0.06)] p-4">
                  <p className="text-[10px] uppercase tracking-[1.5px] text-[rgba(200,126,255,0.60)]">Source</p>
                  <p className="mt-1.5 text-[15px] font-semibold text-[#c87eff]">{lyricsInspection.sourceLabel ?? "Unknown"}</p>
                </div>
                <div className="rounded-[16px] border border-[rgba(255,20,100,0.16)] bg-[rgba(255,20,100,0.06)] p-4">
                  <p className="text-[10px] uppercase tracking-[1.5px] text-[rgba(255,20,100,0.55)]">Kind</p>
                  <p className="mt-1.5 capitalize text-[15px] font-semibold text-[#ff4d96]">{lyricsInspection.kind}</p>
                </div>
                <div className="rounded-[16px] border border-[rgba(64,232,255,0.18)] bg-[rgba(64,232,255,0.06)] p-4">
                  <p className="text-[10px] uppercase tracking-[1.5px] text-[rgba(64,232,255,0.60)]">Synced lines</p>
                  <p className="mt-1.5 text-[15px] font-semibold text-[#40e8ff]">{lyricsInspection.lineCount}</p>
                </div>
                <div className="rounded-[16px] border border-[rgba(63,255,170,0.18)] bg-[rgba(63,255,170,0.06)] p-4">
                  <p className="text-[10px] uppercase tracking-[1.5px] text-[rgba(63,255,170,0.60)]">Last modified</p>
                  <p className="mt-1.5 text-[15px] font-semibold text-[#3fffaa]">{formatUpdatedAt(lyricsInspection.lastModifiedAt)}</p>
                </div>
              </div>

              {lyricsInspection.parseError ? (
                <div className="mt-4 rounded-[14px] border border-[rgba(255,160,30,0.20)] bg-[rgba(255,160,30,0.08)] p-4 text-[13px] text-[#ffc87a]">
                  Lafz found a lyrics cache file, but it could not be parsed cleanly: {lyricsInspection.parseError}
                </div>
              ) : null}

              <pre className="mt-4 max-h-[50vh] overflow-auto rounded-[16px] border border-[rgba(255,20,100,0.10)] bg-black/30 p-5 text-[12px] leading-[1.7] text-[#c8b8d8]">
                {lyricsInspection.preview}
              </pre>
            </>
          ) : (
            <StatePanel
              eyebrow="No cached lyrics yet"
              title="Import local lyrics to start translating"
              description="Lafz keeps original lyrics in a local gitignored cache file so you can use them without storing the content in the repo."
              className="mt-4 border-white/8 bg-white/[0.03] shadow-none"
            />
          )}
        </section>

        {/* AI draft workspace */}
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

        {/* Generation history */}
        <section className="mb-6 rounded-[24px] border border-[rgba(255,20,100,0.12)] bg-[rgba(10,7,22,0.75)] p-6 backdrop-blur-[20px]">
          <div className="mb-4 flex items-center gap-3">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 flex-shrink-0 fill-[rgba(255,20,100,0.6)]" aria-hidden="true">
              <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.75 3.5v4.25l3 1.5-.53 1.06-3.47-1.73V4.5h1z" />
            </svg>
            <p className="text-[11px] font-bold uppercase tracking-[2.2px] text-[rgba(255,20,100,0.65)]">
              Generation history
            </p>
          </div>
          <GenerationHistory spotifyTrackId={record.spotify_track_id} />
        </section>
      </div>

      <style>{`@keyframes lafz-shimmer { to { background-position: -250% 0; } }`}</style>
    </main>
  );
}
