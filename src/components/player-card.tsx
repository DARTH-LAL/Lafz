"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

import { ProgressBar } from "@/components/progress-bar";
import type { PlaybackState } from "@/features/spotify/types";

function ShuffleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41Zm3.91-5.17 2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5Zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13Z" />
    </svg>
  );
}

function PrevIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current" aria-hidden="true">
      <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
      <path d="M6 19h4V5H6v14Zm8-14v14h4V5h-4Z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
      <path d="m8 5 11 7L8 19V5Z" />
    </svg>
  );
}

function NextIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current" aria-hidden="true">
      <path d="M16 6h2v12h-2zm-1.5 6L6 18V6z" />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7Zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4Z" />
    </svg>
  );
}

function SpotifyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M12 1.75A10.25 10.25 0 1 0 22.25 12 10.26 10.26 0 0 0 12 1.75Zm4.7 14.78a.64.64 0 0 1-.88.21 10.78 10.78 0 0 0-5.92-1.64 15.84 15.84 0 0 0-3.25.35.64.64 0 1 1-.27-1.26 17.16 17.16 0 0 1 3.52-.38 12.05 12.05 0 0 1 6.61 1.86.64.64 0 0 1 .19.86Zm1.26-2.42a.79.79 0 0 1-1.08.26 13.61 13.61 0 0 0-7.17-1.86 18.06 18.06 0 0 0-3.67.4.79.79 0 0 1-.32-1.55 19.26 19.26 0 0 1 3.99-.43 15.06 15.06 0 0 1 7.99 2.11.79.79 0 0 1 .26 1.07Zm.12-2.55a16.17 16.17 0 0 0-8.34-2.1 19.92 19.92 0 0 0-4.18.46.94.94 0 0 1-.4-1.84 21.65 21.65 0 0 1 4.56-.5 17.84 17.84 0 0 1 9.27 2.36.94.94 0 1 1-.91 1.61Z" />
    </svg>
  );
}

function TrackDetailIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M4 5h16v2H4zm0 6h10v2H4zm0 6h16v2H4zm12.5-6.5 1.5 1.5 3-3 1.5 1.5-4.5 4.5z" />
    </svg>
  );
}

function DisconnectIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M10.09 15.59 11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59ZM19 3H8a2 2 0 0 0-2 2v3h2V5h11v14H8v-3H6v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Z" />
    </svg>
  );
}

type PlayerCardProps = {
  playback: PlaybackState;
  visualProgressMs: number;
  onPlaybackCommand: (
    command:
      | { action: "play" | "pause" | "next" | "previous" }
      | { action: "seek"; positionMs: number }
      | { action: "shuffle"; enabled: boolean }
      | { action: "repeat"; mode: "off" | "context" | "track" }
  ) => Promise<void>;
};

export function PlayerCard({ playback, visualProgressMs, onPlaybackCommand }: PlayerCardProps) {
  if (!playback.track) {
    return null;
  }

  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const triggerCommand = async (
    action:
      | { action: "play" | "pause" | "next" | "previous" }
      | { action: "seek"; positionMs: number }
      | { action: "shuffle"; enabled: boolean }
      | { action: "repeat"; mode: "off" | "context" | "track" }
  ) => {
    setPendingAction(action.action);

    try {
      await onPlaybackCommand(action);
    } finally {
      setPendingAction((current) => (current === action.action ? null : current));
    }
  };

  const nextRepeatMode = playback.repeatMode === "off" ? "context" : playback.repeatMode === "context" ? "track" : "off";

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden px-7 py-6">
      <div className="relative mb-5 flex-shrink-0">
        <div className="lafz-beat-glow absolute -inset-3 rounded-[28px] bg-[radial-gradient(ellipse_at_50%_60%,rgba(255,45,120,0.3)_0%,rgba(255,140,66,0.14)_42%,transparent_72%)] blur-[18px]" />
        <div className="relative aspect-square overflow-hidden rounded-[22px] border border-white/10 bg-[#130f20]">
          {playback.track.albumArtUrl ? (
            <Image
              src={playback.track.albumArtUrl}
              alt={`${playback.track.album} album art`}
              fill
              priority
              className="object-cover"
              sizes="(max-width: 1024px) 100vw, 360px"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_22%_30%,rgba(255,45,120,0.45)_0%,transparent_48%),radial-gradient(circle_at_78%_72%,rgba(255,140,66,0.25)_0%,transparent_42%),radial-gradient(circle_at_58%_18%,rgba(160,60,220,0.2)_0%,transparent_42%),linear-gradient(145deg,#1e0d36_0%,#2e104a_30%,#3d1230_60%,#1c1435_100%)]">
              <div className="lafz-ring-pulse absolute h-[140px] w-[140px] rounded-full border border-[rgba(255,45,120,0.2)]" />
              <svg viewBox="0 0 24 24" className="relative z-10 h-12 w-12 fill-[rgba(255,240,246,0.2)]" aria-hidden="true">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          )}

          <div className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-full border border-white/12 bg-[rgba(7,5,16,0.72)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[#fff0f6] backdrop-blur-xl">
            <span className="lafz-badge-ring h-1.5 w-1.5 rounded-full bg-[#ff2d78]" />
            {playback.isPlaying ? "Playing" : "Paused"}
          </div>
        </div>
      </div>

      <div className="mb-4 flex-shrink-0">
        <h1 className="text-[24px] font-extrabold leading-[1.1] tracking-[-0.9px] text-[#fff0f6]">{playback.track.title}</h1>
        <p className="mt-1 text-[14px] font-normal text-[#8570a0]">{playback.track.artist}</p>
        <p className="mt-1 text-[12px] font-light text-[#50445f]">{playback.track.album}</p>
      </div>

      <div className="mb-6 flex-shrink-0">
        <ProgressBar
          currentMs={visualProgressMs}
          totalMs={playback.track.durationMs}
          onSeek={async (positionMs) => {
            await triggerCommand({ action: "seek", positionMs });
          }}
        />
      </div>

      <div className="mb-auto flex flex-shrink-0 items-center justify-center gap-4">
        <button
          type="button"
          onClick={() => {
            void triggerCommand({ action: "shuffle", enabled: !playback.shuffleEnabled });
          }}
          disabled={pendingAction !== null}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition ${
            playback.shuffleEnabled
              ? "border-[rgba(255,45,120,0.34)] bg-[linear-gradient(135deg,#ff2d78_0%,#ff5aa8_100%)] text-white shadow-[0_10px_30px_rgba(255,45,120,0.24)]"
              : "border-[rgba(255,45,120,0.18)] bg-[linear-gradient(135deg,rgba(255,45,120,0.14)_0%,rgba(255,107,168,0.1)_100%)] text-[#ffb8d0] shadow-[0_8px_24px_rgba(255,45,120,0.08)]"
          } ${pendingAction !== null ? "cursor-wait opacity-70" : "hover:scale-110 hover:border-[rgba(255,45,120,0.34)] hover:text-white hover:shadow-[0_10px_30px_rgba(255,45,120,0.18)]"}`}
          aria-label="Shuffle"
        >
          <ShuffleIcon />
        </button>
        <button
          type="button"
          onClick={() => {
            void triggerCommand({ action: "previous" });
          }}
          disabled={pendingAction !== null}
          className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(255,45,120,0.18)] bg-[linear-gradient(135deg,rgba(255,45,120,0.14)_0%,rgba(255,107,168,0.1)_100%)] text-[#ffb8d0] shadow-[0_8px_24px_rgba(255,45,120,0.08)] transition ${pendingAction !== null ? "cursor-wait opacity-70" : "hover:scale-110 hover:border-[rgba(255,45,120,0.34)] hover:text-white hover:shadow-[0_10px_30px_rgba(255,45,120,0.18)]"}`}
          aria-label="Previous"
        >
          <PrevIcon />
        </button>
        <button
          type="button"
          onClick={() => {
            void triggerCommand({ action: playback.isPlaying ? "pause" : "play" });
          }}
          disabled={pendingAction !== null}
          className="inline-flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff2d78_0%,#ff5aa8_100%)] text-white shadow-[0_4px_24px_rgba(255,45,120,0.3)] transition hover:scale-[1.05] hover:shadow-[0_6px_32px_rgba(255,45,120,0.4)]"
          aria-label={playback.isPlaying ? "Pause" : "Play"}
        >
          {playback.isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          type="button"
          onClick={() => {
            void triggerCommand({ action: "next" });
          }}
          disabled={pendingAction !== null}
          className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(255,45,120,0.18)] bg-[linear-gradient(135deg,rgba(255,45,120,0.14)_0%,rgba(255,107,168,0.1)_100%)] text-[#ffb8d0] shadow-[0_8px_24px_rgba(255,45,120,0.08)] transition ${pendingAction !== null ? "cursor-wait opacity-70" : "hover:scale-110 hover:border-[rgba(255,45,120,0.34)] hover:text-white hover:shadow-[0_10px_30px_rgba(255,45,120,0.18)]"}`}
          aria-label="Next"
        >
          <NextIcon />
        </button>
        <button
          type="button"
          onClick={() => {
            void triggerCommand({ action: "repeat", mode: nextRepeatMode });
          }}
          disabled={pendingAction !== null}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition ${
            playback.repeatMode !== "off"
              ? "border-[rgba(255,45,120,0.34)] bg-[linear-gradient(135deg,#ff2d78_0%,#ff5aa8_100%)] text-white shadow-[0_10px_30px_rgba(255,45,120,0.24)]"
              : "border-[rgba(255,45,120,0.18)] bg-[linear-gradient(135deg,rgba(255,45,120,0.14)_0%,rgba(255,107,168,0.1)_100%)] text-[#ffb8d0] shadow-[0_8px_24px_rgba(255,45,120,0.08)]"
          } ${pendingAction !== null ? "cursor-wait opacity-70" : "hover:scale-110 hover:border-[rgba(255,45,120,0.34)] hover:text-white hover:shadow-[0_10px_30px_rgba(255,45,120,0.18)]"}`}
          aria-label="Repeat"
        >
          <RepeatIcon />
        </button>
      </div>

      <div className="mt-6 flex-shrink-0">
        <div className="mb-4 text-[12px] font-medium text-[#6f607f]">
          Playing on <span className="text-[#fff0f6]">{playback.deviceName ?? "Spotify app"}</span>
        </div>

        <div className="grid gap-3">
          {playback.track.externalUrl ? (
            <a
              href={playback.track.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full border border-[rgba(255,45,120,0.24)] bg-[linear-gradient(135deg,#ff2d78_0%,#ff5aa8_100%)] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_32px_rgba(255,45,120,0.18)] transition hover:translate-y-[-1px] hover:opacity-95"
            >
              <SpotifyIcon />
              Open in Spotify
            </a>
          ) : null}

          <Link
            href={`/library/track/${playback.track.spotifyTrackId}`}
            className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full border border-[rgba(255,45,120,0.24)] bg-[linear-gradient(135deg,#ff2d78_0%,#ff5aa8_100%)] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_32px_rgba(255,45,120,0.18)] transition hover:translate-y-[-1px] hover:opacity-95"
          >
            <TrackDetailIcon />
            Track detail
          </Link>

          <form action="/api/spotify/logout" method="post" className="w-full">
            <button
              type="submit"
              className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full border border-[rgba(255,45,120,0.24)] bg-[linear-gradient(135deg,#ff2d78_0%,#ff5aa8_100%)] px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_32px_rgba(255,45,120,0.18)] transition hover:translate-y-[-1px] hover:opacity-95"
            >
              <DisconnectIcon />
              Disconnect
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
