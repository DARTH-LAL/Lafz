"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AnimatedBackground } from "@/components/animated-background";
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
    <main className="relative h-[100dvh] overflow-hidden text-[#fff0f6] [font-family:var(--font-jakarta)]">
      <AnimatedBackground />

      <div className="relative z-10 grid h-full min-h-0 grid-rows-[84px_1fr] lg:grid-cols-[360px_1fr] lg:grid-rows-[84px_1fr]">
        <div className="col-span-full px-4 pt-4 lg:px-6 lg:pt-5">
          <AppTopBar connected className="h-14" />
        </div>

        {status === "loading" && !payload ? (
          <div className="col-span-full flex items-center justify-center p-5 lg:p-8">
            <div className="lafz-card flex flex-col items-center gap-4 p-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[rgba(255,20,100,0.25)] bg-[rgba(255,20,100,0.10)] text-2xl">
                ⏳
              </div>
              <p className="text-[11px] font-bold uppercase tracking-[2.5px] text-[#ff1464]">Connecting</p>
              <p className="text-[20px] font-bold text-white">Checking your Spotify playback…</p>
              <p className="max-w-sm text-[14px] leading-[1.7] text-white">Lafz is reading your session and looking for a matching translation file.</p>
            </div>
          </div>
        ) : null}

        {status === "error" && !payload ? (
          <div className="col-span-full flex items-center justify-center p-5 lg:p-8">
            <div className="lafz-card flex flex-col items-center gap-4 p-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[rgba(255,100,100,0.30)] bg-[rgba(255,70,70,0.10)] text-2xl">
                ⚠️
              </div>
              <p className="text-[11px] font-bold uppercase tracking-[2.5px] text-[#ff1464]">Connection issue</p>
              <p className="text-[20px] font-bold text-white">Couldn't reach Spotify</p>
              <p className="max-w-sm text-[14px] leading-[1.7] text-white">{errorMessage ?? "Something went wrong reading your playback. It might just be a blip."}</p>
              <button
                type="button"
                onClick={() => { void loadPlayback(); }}
                className="mt-2 inline-flex items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff1464,#ff6aaa)] px-6 py-3 text-[14px] font-bold text-white shadow-[0_0_24px_rgba(255,20,100,0.35)] transition hover:opacity-90"
              >
                Try again
              </button>
            </div>
          </div>
        ) : null}

        {payload && playback ? (
          <>
            {!playback.track ? (
              <div className="col-span-full flex items-center justify-center p-5 lg:p-8">
                <div className="w-full max-w-2xl">
                  {/* Main idle card */}
                  <div className="lafz-card p-10 text-center">
                    {/* Pulsing icon */}
                    <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-[rgba(255,20,100,0.25)] bg-[rgba(255,20,100,0.08)] text-4xl shadow-[0_0_32px_rgba(255,20,100,0.20)]">
                      🎧
                    </div>

                    <p className="mb-2 text-[11px] font-bold uppercase tracking-[2.5px] text-[#ff1464] [text-shadow:0_0_16px_rgba(255,20,100,0.5)]">
                      Ready &amp; listening
                    </p>
                    <h1 className="mb-3 text-[28px] font-extrabold tracking-[-1px] text-white [text-shadow:0_0_24px_rgba(255,255,255,0.20)]">
                      Play something on Spotify
                    </h1>
                    <p className="mx-auto mb-8 max-w-md text-[14px] leading-[1.75] text-white">
                      Lafz is watching your Spotify session. The moment you hit play on any device, it'll lock onto the song and show the translation in real time.
                    </p>

                    {/* Quick actions */}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Link
                        href="/library/queue"
                        className="flex items-center gap-3 rounded-[16px] border border-[rgba(255,20,100,0.18)] bg-[rgba(255,20,100,0.06)] p-4 text-left transition hover:border-[rgba(255,20,100,0.35)] hover:bg-[rgba(255,20,100,0.12)]"
                      >
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-[rgba(255,20,100,0.22)] bg-[rgba(255,20,100,0.12)] text-[16px]">📚</span>
                        <div>
                          <p className="text-[13px] font-bold text-[#fff0f6]">Browse library</p>
                          <p className="text-[11px] text-white">View all imported songs</p>
                        </div>
                      </Link>
                      <Link
                        href="/library/import"
                        className="flex items-center gap-3 rounded-[16px] border border-[rgba(255,20,100,0.18)] bg-[rgba(255,20,100,0.06)] p-4 text-left transition hover:border-[rgba(255,20,100,0.35)] hover:bg-[rgba(255,20,100,0.12)]"
                      >
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-[rgba(255,20,100,0.22)] bg-[rgba(255,20,100,0.12)] text-[16px]">＋</span>
                        <div>
                          <p className="text-[13px] font-bold text-[#fff0f6]">Import music</p>
                          <p className="text-[11px] text-white">Add a playlist or track</p>
                        </div>
                      </Link>
                    </div>

                    {/* Disconnect — subtle, at the bottom */}
                    <form action="/api/spotify/logout" method="post" className="mt-6">
                      <button
                        type="submit"
                        className="text-[12px] text-white underline-offset-2 transition hover:text-[#ff6aaa] hover:underline"
                      >
                        Disconnect Spotify
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="min-h-0 overflow-hidden border-b border-[rgba(255,20,100,0.15)] lg:border-b-0 lg:border-r">
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
                    <div className="flex h-full flex-col items-center justify-center gap-6 p-5 lg:p-8">
                      <div className="lafz-card w-full max-w-sm p-6 text-center">
                        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-[rgba(255,20,100,0.25)] bg-[rgba(255,20,100,0.10)] text-xl">
                          {payload.aiDraft ? "✏️" : "🎵"}
                        </div>
                        <p className="text-[11px] font-bold uppercase tracking-[2px] text-[#ff1464]">Now playing</p>
                        <p className="mt-2 truncate text-[16px] font-bold text-white">{playback.track.title}</p>
                        <p className="mt-0.5 truncate text-[13px] text-[rgba(255,20,100,0.65)]">{playback.track.artist}</p>
                        <p className="mt-4 text-[13px] leading-[1.65] text-white">
                          {payload.aiDraft
                            ? "An AI draft exists — open the track page to review it and enable real-time sync."
                            : "This song hasn't been translated yet."}
                        </p>
                        {payload.aiDraft && (
                          <Link
                            href={resolvedTrackDetailHref}
                            className="mt-5 inline-flex w-full items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff1464,#ff6aaa)] px-4 py-2.5 text-[13px] font-bold text-white shadow-[0_0_20px_rgba(255,20,100,0.30)] transition hover:opacity-90"
                          >
                            Open track page
                          </Link>
                        )}
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
