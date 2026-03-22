"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

import { StatePanel } from "@/components/state-panel";
import type {
  PlaylistImportApiResponse,
  PlaylistImportResult,
  TrackImportApiResponse,
  TrackImportResult,
  TrackImportStubOutcome
} from "@/features/spotify/types";

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatStubOutcome(outcome: TrackImportStubOutcome) {
  switch (outcome) {
    case "created":
      return "Created";
    case "overwritten":
      return "Overwritten";
    case "preserved":
      return "Preserved";
    case "not_requested":
      return "Not requested";
    default:
      return "Unknown";
  }
}

export function PlaylistImportClient() {
  const [playlistInput, setPlaylistInput] = useState("");
  const [playlistCreateMissingTranslationStubs, setPlaylistCreateMissingTranslationStubs] = useState(true);
  const [playlistOverwriteExistingStubs, setPlaylistOverwriteExistingStubs] = useState(false);
  const [playlistStatus, setPlaylistStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [playlistErrorMessage, setPlaylistErrorMessage] = useState<string | null>(null);
  const [playlistSummary, setPlaylistSummary] = useState<PlaylistImportResult | null>(null);

  const [trackInput, setTrackInput] = useState("");
  const [trackCreateMissingTranslationStubs, setTrackCreateMissingTranslationStubs] = useState(true);
  const [trackOverwriteExistingStubs, setTrackOverwriteExistingStubs] = useState(false);
  const [trackStatus, setTrackStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [trackErrorMessage, setTrackErrorMessage] = useState<string | null>(null);
  const [trackSummary, setTrackSummary] = useState<TrackImportResult | null>(null);

  async function handlePlaylistSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPlaylistStatus("submitting");
    setPlaylistErrorMessage(null);

    try {
      const response = await fetch("/api/library/import-playlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          playlistInput,
          createMissingTranslationStubs: playlistCreateMissingTranslationStubs,
          overwriteExistingStubs: playlistOverwriteExistingStubs
        })
      });

      const payload = (await response.json()) as PlaylistImportApiResponse;

      if (!payload.success) {
        throw new Error(payload.error);
      }

      if (!response.ok) {
        throw new Error("Playlist import failed.");
      }

      setPlaylistSummary(payload.summary);
      setPlaylistStatus("success");
    } catch (error) {
      setPlaylistSummary(null);
      setPlaylistStatus("error");
      setPlaylistErrorMessage(error instanceof Error ? error.message : "Playlist import failed.");
    }
  }

  async function handleTrackSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTrackStatus("submitting");
    setTrackErrorMessage(null);

    try {
      const response = await fetch("/api/library/import-track", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          trackInput,
          createMissingTranslationStubs: trackCreateMissingTranslationStubs,
          overwriteExistingStubs: trackOverwriteExistingStubs
        })
      });

      const payload = (await response.json()) as TrackImportApiResponse;

      if (!payload.success) {
        throw new Error(payload.error);
      }

      if (!response.ok) {
        throw new Error("Single-song import failed.");
      }

      setTrackSummary(payload.summary);
      setTrackStatus("success");
    } catch (error) {
      setTrackSummary(null);
      setTrackStatus("error");
      setTrackErrorMessage(error instanceof Error ? error.message : "Single-song import failed.");
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-8 lg:px-10">
      <header className="mb-8 flex flex-col gap-4 border-b border-white/8 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#ff6ba8]/80">Lafz library tools</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Import a Spotify playlist or single song into a local Lafz song library.
          </h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/library/queue"
            className="inline-flex items-center justify-center rounded-full border border-[rgba(255,45,120,0.2)] bg-[rgba(255,45,120,0.09)] px-5 py-3 text-sm font-semibold text-[#fff0f6] transition hover:bg-[rgba(255,45,120,0.14)]"
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
        <div className="space-y-6">
          <section className="rounded-[32px] border border-white/10 bg-[color:var(--lafz-panel-strong)] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.4)] backdrop-blur-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#ff6ba8]/80">Playlist importer</p>
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

            <form className="mt-8 space-y-5" onSubmit={handlePlaylistSubmit}>
              <label className="block">
                <span className="text-sm font-semibold text-slate-200">Playlist URL or ID</span>
                <input
                  value={playlistInput}
                  onChange={(event) => setPlaylistInput(event.target.value)}
                  placeholder="https://open.spotify.com/playlist/... or 37i9dQZF..."
                  className="mt-3 w-full rounded-[20px] border border-white/12 bg-black/20 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-[#ff2d78]/50"
                />
              </label>

              <label className="flex items-start gap-3 rounded-[20px] border border-white/8 bg-white/[0.03] p-4 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={playlistCreateMissingTranslationStubs}
                  onChange={(event) => {
                    const nextChecked = event.target.checked;
                    setPlaylistCreateMissingTranslationStubs(nextChecked);

                    if (!nextChecked) {
                      setPlaylistOverwriteExistingStubs(false);
                    }
                  }}
                  className="mt-1 h-4 w-4 rounded border-white/20 bg-slate-950 text-[#ff6ba8]"
                />
                <span>Create missing translation stub files for imported playlist tracks.</span>
              </label>

              <label className="flex items-start gap-3 rounded-[20px] border border-white/8 bg-white/[0.03] p-4 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={playlistOverwriteExistingStubs}
                  onChange={(event) => setPlaylistOverwriteExistingStubs(event.target.checked)}
                  disabled={!playlistCreateMissingTranslationStubs}
                  className="mt-1 h-4 w-4 rounded border-white/20 bg-slate-950 text-[#ff6ba8] disabled:opacity-40"
                />
                <span>
                  Overwrite existing translation stub files. Leave this off to preserve anything already in
                  <span className="mx-2 rounded bg-white/8 px-2 py-1 font-mono text-xs text-slate-200">data/translations/local</span>.
                </span>
              </label>

              <button
                type="submit"
                disabled={playlistStatus === "submitting"}
                className="inline-flex w-full items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff2d78_0%,#ff8c42_100%)] px-6 py-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {playlistStatus === "submitting" ? "Importing playlist..." : "Import playlist"}
              </button>
            </form>
          </section>

          <section className="rounded-[32px] border border-white/10 bg-[color:var(--lafz-panel-strong)] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.35)] backdrop-blur-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#ff6ba8]/80">Single-song import</p>
            <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white">
              Pull one track into Lafz without building a whole playlist first.
            </h2>
            <p className="mt-3 text-base leading-7 text-slate-300">
              Paste a Spotify track URL or raw track ID. Lafz will fetch the song metadata, write a small local library
              JSON file for that track, and optionally create a starter translation stub.
            </p>

            <form className="mt-8 space-y-5" onSubmit={handleTrackSubmit}>
              <label className="block">
                <span className="text-sm font-semibold text-slate-200">Track URL or ID</span>
                <input
                  value={trackInput}
                  onChange={(event) => setTrackInput(event.target.value)}
                  placeholder="https://open.spotify.com/track/... or 3n3Ppam7vgaVa1iaRUc9Lp"
                  className="mt-3 w-full rounded-[20px] border border-white/12 bg-black/20 px-4 py-3 text-base text-white outline-none transition placeholder:text-slate-500 focus:border-[#ff2d78]/50"
                />
              </label>

              <label className="flex items-start gap-3 rounded-[20px] border border-white/8 bg-white/[0.03] p-4 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={trackCreateMissingTranslationStubs}
                  onChange={(event) => {
                    const nextChecked = event.target.checked;
                    setTrackCreateMissingTranslationStubs(nextChecked);

                    if (!nextChecked) {
                      setTrackOverwriteExistingStubs(false);
                    }
                  }}
                  className="mt-1 h-4 w-4 rounded border-white/20 bg-slate-950 text-[#ff6ba8]"
                />
                <span>Create a translation stub for this song if one does not exist yet.</span>
              </label>

              <label className="flex items-start gap-3 rounded-[20px] border border-white/8 bg-white/[0.03] p-4 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={trackOverwriteExistingStubs}
                  onChange={(event) => setTrackOverwriteExistingStubs(event.target.checked)}
                  disabled={!trackCreateMissingTranslationStubs}
                  className="mt-1 h-4 w-4 rounded border-white/20 bg-slate-950 text-[#ff6ba8] disabled:opacity-40"
                />
                <span>
                  Overwrite an existing translation stub for this song. Leave this off to preserve anything already in
                  <span className="mx-2 rounded bg-white/8 px-2 py-1 font-mono text-xs text-slate-200">data/translations/local</span>.
                </span>
              </label>

              <button
                type="submit"
                disabled={trackStatus === "submitting"}
                className="inline-flex w-full items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff2d78_0%,#ff8c42_100%)] px-6 py-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {trackStatus === "submitting" ? "Importing song..." : "Import song"}
              </button>
            </form>
          </section>
        </div>

        <div className="space-y-5">
          <StatePanel
            eyebrow="Local output"
            title="What Lafz writes"
            description="Imports stay local. This page can write playlist library files, single-song library files, and optional translation stubs."
          >
            <div className="grid gap-4 text-sm text-slate-300 sm:grid-cols-3">
              <div className="rounded-[22px] border border-white/8 bg-black/10 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Playlist library file</p>
                <p className="mt-2 font-mono text-xs text-slate-200">data/library/playlists/&lt;playlistId&gt;.json</p>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-black/10 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Single-song file</p>
                <p className="mt-2 font-mono text-xs text-slate-200">data/library/playlists/single-track-&lt;spotifyTrackId&gt;.json</p>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-black/10 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Translation stubs</p>
                <p className="mt-2 font-mono text-xs text-slate-200">data/translations/local/&lt;spotifyTrackId&gt;.json</p>
              </div>
            </div>
          </StatePanel>

          {playlistStatus === "error" && playlistErrorMessage ? (
            <StatePanel eyebrow="Import error" title="Lafz could not import that playlist" description={playlistErrorMessage} />
          ) : null}

          {trackStatus === "error" && trackErrorMessage ? (
            <StatePanel eyebrow="Import error" title="Lafz could not import that song" description={trackErrorMessage} />
          ) : null}

          {playlistSummary ? (
            <StatePanel
              eyebrow="Playlist summary"
              title={playlistSummary.playlistName}
              description="The playlist import finished and Lafz wrote the normalized local files below."
            >
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Total tracks fetched</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{playlistSummary.totalTracksFetched}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Imported count</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{playlistSummary.importedCount}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Skipped count</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{playlistSummary.skippedCount}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Stub files created</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{playlistSummary.stubFilesCreatedCount}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Stub files overwritten</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{playlistSummary.stubFilesOverwrittenCount}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Stub files preserved</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{playlistSummary.stubFilesSkippedCount}</p>
                </div>
              </div>

              <div className="mt-6 rounded-[22px] border border-dashed border-white/12 bg-black/10 p-4 text-sm text-slate-300">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Playlist file path</p>
                <p className="mt-2 break-all font-mono text-xs text-slate-200">{playlistSummary.playlistFilePath}</p>
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/library/queue"
                  className="inline-flex items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff2d78_0%,#ff8c42_100%)] px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Open translation queue
                </Link>
              </div>

              <div className="mt-6 rounded-[22px] border border-white/8 bg-black/10 p-4 text-sm text-slate-300">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Skipped reasons</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <p className="text-slate-500">Duplicates</p>
                    <p className="mt-1 text-lg text-white">{playlistSummary.skippedReasons.duplicate_track}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Local tracks</p>
                    <p className="mt-1 text-lg text-white">{playlistSummary.skippedReasons.local_track}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Unavailable tracks</p>
                    <p className="mt-1 text-lg text-white">{playlistSummary.skippedReasons.unavailable_track}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">Unsupported items</p>
                    <p className="mt-1 text-lg text-white">{playlistSummary.skippedReasons.unsupported_item}</p>
                  </div>
                </div>
              </div>
            </StatePanel>
          ) : null}

          {trackSummary ? (
            <StatePanel
              eyebrow="Single-song summary"
              title={trackSummary.trackTitle}
              description={`${trackSummary.trackArtist} • ${trackSummary.trackAlbum}`}
            >
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Track ID</p>
                  <p className="mt-2 break-all font-mono text-xs text-slate-200">{trackSummary.trackId}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Duration</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{formatDuration(trackSummary.trackDurationMs)}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Stub outcome</p>
                  <p className="mt-2 text-2xl font-semibold text-white">{formatStubOutcome(trackSummary.stubFileOutcome)}</p>
                </div>
                <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Collection ID</p>
                  <p className="mt-2 break-all font-mono text-xs text-slate-200">{trackSummary.syntheticLibraryId}</p>
                </div>
              </div>

              <div className="mt-6 rounded-[22px] border border-dashed border-white/12 bg-black/10 p-4 text-sm text-slate-300">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Single-song library file path</p>
                <p className="mt-2 break-all font-mono text-xs text-slate-200">{trackSummary.libraryFilePath}</p>
              </div>

              {trackSummary.stubFilePath ? (
                <div className="mt-4 rounded-[22px] border border-dashed border-white/12 bg-black/10 p-4 text-sm text-slate-300">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Translation stub path</p>
                  <p className="mt-2 break-all font-mono text-xs text-slate-200">{trackSummary.stubFilePath}</p>
                </div>
              ) : null}

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/library/queue"
                  className="inline-flex items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff2d78_0%,#ff8c42_100%)] px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  Open translation queue
                </Link>
                {trackSummary.trackUrl ? (
                  <a
                    href={trackSummary.trackUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
                  >
                    Open on Spotify
                  </a>
                ) : null}
              </div>
            </StatePanel>
          ) : null}
        </div>
      </div>
    </main>
  );
}
