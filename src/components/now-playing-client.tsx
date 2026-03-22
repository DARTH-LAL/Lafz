"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { LyricsPanel } from "@/components/lyrics-panel";
import { PlayerCard } from "@/components/player-card";
import { StatePanel } from "@/components/state-panel";
import { UntimedLyricsPanel } from "@/components/untimed-lyrics-panel";
import { PLAYBACK_POLL_INTERVAL_MS } from "@/features/spotify/config";
import type { PlaybackApiResponse } from "@/features/spotify/types";
import { usePlaybackClock } from "@/features/sync/use-playback-clock";
import type { SpotifyRepeatMode } from "@/features/spotify/types";

function QueueIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z" />
    </svg>
  );
}

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

    const pollTimer = window.setInterval(() => {
      void loadPlayback(true);
    }, PLAYBACK_POLL_INTERVAL_MS);

    return () => window.clearInterval(pollTimer);
  }, [loadPlayback]);

  const visualProgressMs = usePlaybackClock(payload?.playback ?? null);
  const playback = payload?.playback ?? null;

  const handlePlaybackCommand = useCallback(
    async (
      command:
        | { action: "play" | "pause" | "next" | "previous" }
        | { action: "seek"; positionMs: number }
        | { action: "shuffle"; enabled: boolean }
        | { action: "repeat"; mode: SpotifyRepeatMode }
    ) => {
      try {
        const response = await fetch("/api/playback/control", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(command)
        });

        if (response.status === 401) {
          router.replace("/login?reason=session_expired");
          return;
        }

        const body = (await response.json()) as
          | { success: true; playback: NonNullable<PlaybackApiResponse["playback"]> }
          | { error?: string };

        if (!response.ok) {
          throw new Error("error" in body && body.error ? body.error : "Spotify could not process that playback command.");
        }

        if ("success" in body && body.success) {
          const nextPlayback = body.playback;

          setPayload((current) => {
            if (!current) {
              return current;
            }

            const previousTrackId = current.playback.track?.spotifyTrackId ?? null;
            const nextTrackId = nextPlayback.track?.spotifyTrackId ?? null;
            const trackChanged = previousTrackId !== nextTrackId;

            return {
              ...current,
              playback: nextPlayback,
              translation: trackChanged ? null : current.translation,
              aiDraft: trackChanged ? null : current.aiDraft
            };
          });

          window.setTimeout(() => {
            void loadPlayback(true);
          }, 220);
        }

        setErrorMessage(null);
      } catch (error) {
        const nextMessage =
          error instanceof Error
            ? error.message
            : "Lafz could not send that playback command to Spotify.";
        setErrorMessage(nextMessage);
      }
    },
    [loadPlayback, router]
  );

  return (
    <main className="relative h-[100dvh] overflow-hidden [font-family:var(--font-jakarta)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-[360px] -top-[420px] h-[1080px] w-[1080px] rounded-full bg-[radial-gradient(circle,rgba(255,45,120,0.09)_0%,transparent_58%)]" />
        <div className="absolute -left-[200px] bottom-[-160px] h-[460px] w-[720px] rotate-[-15deg] bg-[radial-gradient(ellipse,rgba(255,140,66,0.06)_0%,transparent_68%)]" />
        <div className="absolute left-[20%] top-[30%] h-[400px] w-[400px] rounded-full bg-[radial-gradient(circle,rgba(120,60,200,0.05)_0%,transparent_66%)]" />
      </div>

      <div className="relative z-10 grid h-full min-h-0 grid-rows-[56px_1fr] lg:grid-cols-[360px_1fr] lg:grid-rows-[56px_1fr]">
        <nav className="col-span-full flex items-center justify-between border-b border-white/6 bg-[rgba(7,5,16,0.7)] px-5 backdrop-blur-2xl lg:px-8">
          <div className="text-[20px] font-extrabold tracking-[-0.8px] text-[#fff0f6]">
            la
            <span className="bg-[linear-gradient(135deg,#ff2d78_0%,#ff6ba8_100%)] bg-clip-text text-transparent">F</span>
            z
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border border-[rgba(255,45,120,0.22)] bg-[rgba(255,45,120,0.09)] px-3 py-1.5 text-[11px] font-semibold text-[#ff6ba8] sm:inline-flex">
              <span className="lafz-badge-ring h-1.5 w-1.5 rounded-full bg-[#ff2d78]" />
              Spotify connected
            </div>
            <Link
              href="/library/queue"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 text-[#8570a0] transition hover:border-white/20 hover:bg-white/4 hover:text-white"
              aria-label="Open translation queue"
            >
              <QueueIcon />
            </Link>
            <Link
              href="/library/import"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/12 text-[#8570a0] transition hover:border-white/20 hover:bg-white/4 hover:text-white"
              aria-label="Open importer"
            >
              <ImportIcon />
            </Link>
          </div>
        </nav>

        {status === "loading" && !payload ? (
          <div className="col-span-full p-5 lg:p-8">
            <StatePanel
              eyebrow="Connecting"
              title="Checking your Spotify playback"
              description="Lafz is reading your saved Spotify session, fetching the current track, and looking for a matching local translation file."
              className="h-full"
            />
          </div>
        ) : null}

        {status === "error" && !payload ? (
          <div className="col-span-full p-5 lg:p-8">
            <StatePanel
              eyebrow="Playback error"
              title="Lafz could not read Spotify right now"
              description={errorMessage ?? "The playback snapshot could not be loaded yet."}
              className="h-full"
            >
              <button
                type="button"
                onClick={() => {
                  void loadPlayback();
                }}
                className="inline-flex items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff2d78_0%,#ff8c42_100%)] px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Retry playback check
              </button>
            </StatePanel>
          </div>
        ) : null}

        {payload && playback ? (
          <>
            {!playback.track ? (
              <div className="col-span-full p-5 lg:p-8">
                <StatePanel
                  eyebrow="No active playback"
                  title="Start a song in Spotify to begin syncing"
                  description="Once Spotify is actively playing a track on one of your devices, Lafz will read the current progress, look up a matching local translation JSON file, and follow the song in real time."
                  className="h-full"
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
              </div>
            ) : (
              <>
                <div className="min-h-0 overflow-hidden border-b border-white/6 lg:border-b-0 lg:border-r">
                  <PlayerCard playback={playback} visualProgressMs={visualProgressMs} onPlaybackCommand={handlePlaybackCommand} />
                </div>

                <div className="relative min-h-0 overflow-hidden">
                  {payload.translation ? (
                    <LyricsPanel
                      translation={payload.translation}
                      progressMs={visualProgressMs}
                      isPlaying={playback.isPlaying}
                      onSeek={async (positionMs) => {
                        await handlePlaybackCommand({ action: "seek", positionMs });
                      }}
                    />
                  ) : payload.aiDraft?.mode === "plain" && payload.aiDraft.lines.length > 0 ? (
                    <UntimedLyricsPanel
                      draft={payload.aiDraft}
                      trackTitle={playback.track.title}
                      trackArtist={playback.track.artist}
                      trackHref={`/library/track/${playback.track.spotifyTrackId}`}
                    />
                  ) : (
                    <div className="h-full p-5 lg:p-8">
                      <StatePanel
                        eyebrow={payload.aiDraft ? "Draft only" : "No translation yet"}
                        title={
                          payload.aiDraft
                            ? "This track has a translation draft, but it is not synced for karaoke-style playback yet"
                            : "This track is playing, but Lafz does not have a synced local file for it"
                        }
                        description={
                          payload.aiDraft
                            ? payload.aiDraft.mode === "plain"
                              ? "Lafz found an untimed AI draft for this song, so it stays in plain reading mode until synced lyrics are available."
                              : `Lafz found a synced AI draft for this song, but playback could not materialize the local translation file at ${payload.translationFileHint} yet. Generate the AI draft again from the track page to recreate it.`
                            : `Create ${payload.translationFileHint} with your own timestamped translation data and refresh playback. Lafz will pick it up on the next poll.`
                        }
                        className="h-full"
                      >
                        <div className="rounded-[24px] border border-dashed border-white/12 bg-black/10 p-5 text-sm leading-7 text-slate-300">
                          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Current song</p>
                          <p className="mt-2 text-lg text-white">{playback.track.title}</p>
                          <p className="mt-1 text-slate-400">{playback.track.artist}</p>
                          {payload.aiDraft ? (
                            <div className="mt-4 rounded-[20px] border border-[rgba(255,45,120,0.18)] bg-[rgba(255,45,120,0.08)] p-4 text-sm text-[#fff0f6]">
                              AI draft found: {payload.aiDraft.lineCount} line{payload.aiDraft.lineCount === 1 ? "" : "s"} ({payload.aiDraft.mode}) via {payload.aiDraft.model ?? "AI"}.
                            </div>
                          ) : null}
                          <div className="mt-4 flex flex-wrap gap-3">
                            <Link
                              href={`/library/track/${playback.track.spotifyTrackId}`}
                              className="inline-flex items-center justify-center rounded-full border border-[rgba(255,45,120,0.22)] bg-[rgba(255,45,120,0.09)] px-4 py-2 text-sm font-semibold text-[#fff0f6] transition hover:bg-[rgba(255,45,120,0.14)]"
                            >
                              Open track detail
                            </Link>
                          </div>
                        </div>
                      </StatePanel>
                    </div>
                  )}
                </div>
              </>
            )}

            {errorMessage ? (
              <div className="pointer-events-none fixed bottom-5 left-1/2 z-30 w-[min(92vw,760px)] -translate-x-1/2 rounded-full border border-amber-300/20 bg-[rgba(28,22,12,0.88)] px-5 py-3 text-center text-sm text-amber-100 shadow-[0_16px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
                Lafz is showing the last good playback snapshot while a background refresh retries: {errorMessage}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}
