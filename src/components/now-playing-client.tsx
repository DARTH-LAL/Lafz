"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AppTopBar } from "@/components/app-top-bar";
import { LyricsPanel } from "@/components/lyrics-panel";
import { PlayerCard } from "@/components/player-card";
import { StatePanel } from "@/components/state-panel";
import { UntimedLyricsPanel } from "@/components/untimed-lyrics-panel";
import { PLAYBACK_POLL_INTERVAL_MS } from "@/features/spotify/config";
import type { PlaybackApiResponse } from "@/features/spotify/types";
import { usePlaybackClock } from "@/features/sync/use-playback-clock";
import type { SpotifyRepeatMode } from "@/features/spotify/types";

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
  const resolvedTrackDetailId =
    payload?.translation?.spotifyTrackId ?? payload?.aiDraft?.spotifyTrackId ?? playback?.track?.spotifyTrackId ?? null;
  const resolvedTrackDetailHref = resolvedTrackDetailId
    ? `/library/track/${resolvedTrackDetailId}`
    : playback?.track
      ? `/library/track/${playback.track.spotifyTrackId}`
      : "/library/queue";

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

      <div className="relative z-10 grid h-full min-h-0 grid-rows-[84px_1fr] lg:grid-cols-[360px_1fr] lg:grid-rows-[84px_1fr]">
        <div className="col-span-full px-4 pt-4 lg:px-6 lg:pt-5">
          <AppTopBar connected className="h-14" />
        </div>

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
                      trackHref={resolvedTrackDetailHref}
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-8 p-5 lg:p-8">
                      <div className="flex flex-col items-center gap-3 text-center">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[rgba(255,45,120,0.1)] text-2xl">
                          🎵
                        </div>
                        <h2 className="text-xl font-bold tracking-[-0.4px] text-white">
                          {payload.aiDraft ? "Draft ready — sync coming soon" : "No translation yet"}
                        </h2>
                        <p className="max-w-[260px] text-sm leading-relaxed text-slate-400">
                          {payload.aiDraft
                            ? "An AI draft exists for this song. Open the track page to review and sync it."
                            : "This song hasn't been translated yet. Open the track page to get started."}
                        </p>
                      </div>

                      <div className="w-full max-w-[320px] rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Now playing</p>
                        <p className="mt-2 truncate text-base font-semibold text-white">{playback.track.title}</p>
                        <p className="mt-0.5 truncate text-sm text-slate-400">{playback.track.artist}</p>
                        <Link
                          href={resolvedTrackDetailHref}
                          className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff2d78,#ff8c42)] px-4 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
                        >
                          Open track
                        </Link>
                      </div>
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
