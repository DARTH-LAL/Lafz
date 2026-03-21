"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

import { StatePanel } from "@/components/state-panel";
import type { PlaylistImportApiResponse, PlaylistImportResult } from "@/features/spotify/types";

export function PlaylistImportClient() {
  const [playlistInput, setPlaylistInput] = useState("");
  const [createMissingTranslationStubs, setCreateMissingTranslationStubs] = useState(true);
  const [overwriteExistingStubs, setOverwriteExistingStubs] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<PlaylistImportResult | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/library/import-playlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          playlistInput,
          createMissingTranslationStubs,
          overwriteExistingStubs
        })
      });

      const payload = (await response.json()) as PlaylistImportApiResponse;

      if (!payload.success) {
        throw new Error(payload.error);
      }

      if (!response.ok) {
        throw new Error("Playlist import failed.");
      }

      setSummary(payload.summary);
      setStatus("success");
    } catch (error) {
      setSummary(null);
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Playlist import failed.");
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-8 lg:px-10">
      <header className="mb-8 flex flex-col gap-4 border-b border-white/8 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300/80">Lafz library tools</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Import a Spotify playlist into a local Lafz song library.
          </h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/library/queue"
            className="inline-flex items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/10 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/15"
          >
            Open queue
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
          >
            Back to now playing
          </Link>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(320px,420px)_1fr] lg:items-start">
        <section className="rounded-[32px] border border-white/10 bg-[color:var(--lafz-panel-strong)] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.4)] backdrop-blur-xl">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300/80">Playlist importer</p>
          <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white">
            Build a translation work queue from Spotify.
          </h2>
          <p className="mt-3 text-base leading-7 text-slate-300">
            Paste a Spotify playlist URL or raw playlist ID. Lafz will fetch the playlist tracks, deduplicate them,
            save a local library JSON file, and optionally create empty translation stubs in
            <span className="ml-2 rounded bg-white/8 px-2 py-1 font-mono text-xs text-slate-200">data/translations/local</span>.
          </p>

          <div className="mt-5 rounded-[22px] border border-amber-300/15 bg-amber-300/8 p-4 text-sm leading-7 text-amber-100">
            Spotify's current Development Mode rules may block track imports from public playlists you do not own. If you
            see a <span className="mx-1 rounded bg-black/20 px-2 py-1 font-mono text-xs">403 Forbidden</span> error,
            copy that playlist into one of your own playlists or use a playlist you collaborate on, then import again.
          </div>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            <label className="block">
              <span className="text-sm font-semibold text-slate-200">Playlist URL or ID</span>
              <input
                value={playlistInput}
                onChange={(event) => setPlaylistInput(event.target.value)}
                placeholder="https://open.spotify.com/playlist/... or 37i9dQZF..."
                className="mt-3 w-full rounded-[20px] border border-white/12 bg-black/20 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/50"
              />
            </label>

            <label className="flex items-start gap-3 rounded-[20px] border border-white/8 bg-white/[0.03] p-4 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={createMissingTranslationStubs}
                onChange={(event) => {
                  const nextChecked = event.target.checked;
                  setCreateMissingTranslationStubs(nextChecked);

                  if (!nextChecked) {
                    setOverwriteExistingStubs(false);
                  }
                }}
                className="mt-1 h-4 w-4 rounded border-white/20 bg-slate-950 text-cyan-300"
              />
              <span>
                Create missing translation stub files for imported tracks.
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-[20px] border border-white/8 bg-white/[0.03] p-4 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={overwriteExistingStubs}
                onChange={(event) => setOverwriteExistingStubs(event.target.checked)}
                disabled={!createMissingTranslationStubs}
                className="mt-1 h-4 w-4 rounded border-white/20 bg-slate-950 text-cyan-300 disabled:opacity-40"
              />
              <span>
                Overwrite existing translation stub files. Leave this off to preserve anything already in
                <span className="mx-2 rounded bg-white/8 px-2 py-1 font-mono text-xs text-slate-200">data/translations/local</span>.
              </span>
            </label>

            <button
              type="submit"
              disabled={status === "submitting"}
              className="inline-flex w-full items-center justify-center rounded-full bg-cyan-300 px-6 py-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {status === "submitting" ? "Importing playlist..." : "Import playlist"}
            </button>
          </form>
        </section>

        <div className="space-y-5">
          <StatePanel
            eyebrow="Local output"
            title="What Lafz writes"
            description="Imported playlists stay local. This tool saves a playlist library JSON file and can generate empty translation stubs for tracks that still need work."
          >
            <div className="grid gap-4 text-sm text-slate-300 sm:grid-cols-2">
              <div className="rounded-[22px] border border-white/8 bg-black/10 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Playlist library file</p>
                <p className="mt-2 font-mono text-xs text-slate-200">data/library/playlists/&lt;playlistId&gt;.json</p>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-black/10 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Translation stubs</p>
                <p className="mt-2 font-mono text-xs text-slate-200">data/translations/local/&lt;spotifyTrackId&gt;.json</p>
              </div>
            </div>
          </StatePanel>

          {status === "error" && errorMessage ? (
            <StatePanel
              eyebrow="Import error"
              title="Lafz could not import that playlist"
              description={errorMessage}
            />
          ) : null}

          {summary ? (
            <StatePanel
              eyebrow="Import summary"
              title={summary.playlistName}
              description="The playlist import finished and Lafz wrote the normalized local files below."
            >
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Total tracks fetched</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{summary.totalTracksFetched}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Imported count</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{summary.importedCount}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Skipped count</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{summary.skippedCount}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Stub files created</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{summary.stubFilesCreatedCount}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Stub files overwritten</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{summary.stubFilesOverwrittenCount}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Stub files preserved</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{summary.stubFilesSkippedCount}</p>
                </div>
              </div>

              <div className="mt-6 rounded-[22px] border border-dashed border-white/12 bg-black/10 p-4 text-sm text-slate-300">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Playlist file path</p>
                <p className="mt-2 break-all font-mono text-xs text-slate-200">{summary.playlistFilePath}</p>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/library/queue"
                  className="inline-flex items-center justify-center rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
                >
                  Open translation queue
                </Link>
              </div>

              <div className="mt-6 rounded-[22px] border border-white/8 bg-black/10 p-4 text-sm text-slate-300">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Skipped reasons</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <p className="text-slate-500">Duplicates</p>
                    <p className="mt-1 text-lg text-white">{summary.skippedReasons.duplicate_track}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Local tracks</p>
                    <p className="mt-1 text-lg text-white">{summary.skippedReasons.local_track}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Unavailable tracks</p>
                    <p className="mt-1 text-lg text-white">{summary.skippedReasons.unavailable_track}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Unsupported items</p>
                    <p className="mt-1 text-lg text-white">{summary.skippedReasons.unsupported_item}</p>
                  </div>
                </div>
              </div>
            </StatePanel>
          ) : null}
        </div>
      </div>
    </main>
  );
}
