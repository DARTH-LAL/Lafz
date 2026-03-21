"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { LyricsPanel } from "@/components/lyrics-panel";
import { PlayerCard } from "@/components/player-card";
import { StatePanel } from "@/components/state-panel";
import { PLAYBACK_POLL_INTERVAL_MS } from "@/features/spotify/config";
import type { PlaybackApiResponse } from "@/features/spotify/types";
import { usePlaybackClock } from "@/features/sync/use-playback-clock";

export function NowPlayingClient() {
  const router = useRouter();
  const [payload, setPayload] = useState<PlaybackApiResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const latestPayloadRef = useRef<PlaybackApiResponse | null>(null);

  const loadPlayback = useCallback(
    async (silent = false) => {
      if (!silent && !latestPayloadRef.current) {
        setStatus("loading");
      }

      try {
        const response = await fetch("/api/playback", {
          cache: "no-store"
        });

        if (response.status === 401) {
          router.replace("/login?reason=session_expired");
          return;
        }

        const body = (await response.json()) as PlaybackApiResponse | { error?: string };

        if (!response.ok) {
          throw new Error("error" in body && body.error ? body.error : "Failed to load Spotify playback state.");
        }

        latestPayloadRef.current = body as PlaybackApiResponse;
        setPayload(body as PlaybackApiResponse);
        setStatus("ready");
        setErrorMessage(null);
      } catch (error) {
        const nextMessage = error instanceof Error ? error.message : "Something went wrong while reading Spotify playback.";
        setErrorMessage(nextMessage);

        if (!latestPayloadRef.current) {
          setStatus("error");
        }
      }
    },
    [router]
  );

  useEffect(() => {
    void loadPlayback();

    // Poll the server for fresh Spotify state so we can keep progress and track info updated without the Web Playback SDK.
    const pollTimer = window.setInterval(() => {
      void loadPlayback(true);
    }, PLAYBACK_POLL_INTERVAL_MS);

    return () => window.clearInterval(pollTimer);
  }, [loadPlayback]);

  const visualProgressMs = usePlaybackClock(payload?.playback ?? null);
  const playback = payload?.playback ?? null;

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-6 py-8 lg:px-10">
      <header className="mb-8 flex flex-col gap-4 border-b border-white/8 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300/80">Lafz</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Real-time translated lyrics for the song already playing.
          </h1>
        </div>
        <div className="flex max-w-md flex-col items-start gap-3">
          <p className="text-sm leading-7 text-slate-400">
            Polling Spotify for the current track and progress, then matching a local translation file by Spotify track
            ID.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/library/queue"
              className="inline-flex items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/15"
            >
              Open translation queue
            </Link>
            <Link
              href="/library/import"
              className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
            >
              Open playlist importer
            </Link>
          </div>
        </div>
      </header>

      {status === "loading" && !payload ? (
        <StatePanel
          eyebrow="Connecting"
          title="Checking your Spotify playback"
          description="Lafz is reading your saved Spotify session, fetching the current track, and looking for a matching local translation file."
        />
      ) : null}

      {status === "error" && !payload ? (
        <StatePanel
          eyebrow="Playback error"
          title="Lafz could not read Spotify right now"
          description={errorMessage ?? "The playback snapshot could not be loaded yet."}
        >
          <button
            type="button"
            onClick={() => {
              void loadPlayback();
            }}
            className="inline-flex items-center justify-center rounded-full bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
          >
            Retry playback check
          </button>
        </StatePanel>
      ) : null}

      {payload && playback ? (
        <div className="space-y-5">
          {errorMessage ? (
            <div className="rounded-[24px] border border-amber-300/20 bg-amber-300/10 px-5 py-4 text-sm text-amber-100">
              Lafz is showing the last good playback snapshot while a background refresh retries: {errorMessage}
            </div>
          ) : null}

          {!playback.track ? (
            <StatePanel
              eyebrow="No active playback"
              title="Start a song in Spotify to begin syncing"
              description="Once Spotify is actively playing a track on one of your devices, Lafz will read the current progress, look up a matching local translation JSON file, and follow the song in real time."
            >
              <form action="/api/spotify/logout" method="post" className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
                >
                  Disconnect Spotify
                </button>
              </form>
            </StatePanel>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[minmax(320px,420px)_1fr] lg:items-start">
              <PlayerCard playback={playback} visualProgressMs={visualProgressMs} translation={payload.translation} />

              {payload.translation ? (
                <LyricsPanel
                  translation={payload.translation}
                  progressMs={visualProgressMs}
                  isPlaying={playback.isPlaying}
                />
              ) : (
                <StatePanel
                  eyebrow={payload.aiDraft ? "Draft only" : "No translation yet"}
                  title={
                    payload.aiDraft
                      ? "This track has an AI draft, but it is not playback-ready yet"
                      : "This track is playing, but Lafz does not have a synced local file for it"
                  }
                  description={
                    payload.aiDraft
                      ? payload.aiDraft.mode === "plain"
                        ? `Lafz found an untimed AI draft for this song, but playback only uses timestamped translation files in ${payload.translationFileHint}. Import synced lyrics or create a timed local translation file to make the lyrics appear during playback.`
                        : `Lafz found an AI draft for this song, but it has not been applied to the local playback translation file yet. Save a synced local translation file in ${payload.translationFileHint} and refresh playback.`
                      : `Create ${payload.translationFileHint} with your own timestamped translation data and refresh playback. Lafz will pick it up on the next poll.`
                  }
                  className="min-h-[420px]"
                >
                  <div className="rounded-[24px] border border-dashed border-white/12 bg-black/10 p-5 text-sm leading-7 text-slate-300">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Current song</p>
                    <p className="mt-2 text-lg text-white">{playback.track.title}</p>
                    <p className="mt-1 text-slate-400">{playback.track.artist}</p>
                    {payload.aiDraft ? (
                      <div className="mt-4 rounded-[20px] border border-cyan-300/15 bg-cyan-300/8 p-4 text-sm text-cyan-100">
                        AI draft found: {payload.aiDraft.lineCount} line{payload.aiDraft.lineCount === 1 ? "" : "s"} ({payload.aiDraft.mode}) via {payload.aiDraft.model ?? "AI"}.
                      </div>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-3">
                      <Link
                        href={`/library/track/${playback.track.spotifyTrackId}`}
                        className="inline-flex items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/15"
                      >
                        Open track detail
                      </Link>
                    </div>
                  </div>
                </StatePanel>
              )}
            </div>
          )}
        </div>
      ) : null}
    </main>
  );
}
