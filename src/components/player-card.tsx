"use client";

import { useEffect, useRef, useState } from "react";
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
  beatCount?: number;
  debugBpm?: number | null;
  onPlaybackCommand: (
    command:
      | { action: "play" | "pause" | "next" | "previous" }
      | { action: "seek"; positionMs: number }
      | { action: "shuffle"; enabled: boolean }
      | { action: "repeat"; mode: "off" | "context" | "track" }
  ) => Promise<void>;
};

export function PlayerCard({ playback, visualProgressMs, beatCount = 0, debugBpm, onPlaybackCommand }: PlayerCardProps) {
  if (!playback.track) {
    return null;
  }

  const [pendingAction, setPendingAction] = useState<string | null>(null);

  // Beat glow — outer ring outside overflow-hidden so shadow radiates outward
  const ringRef      = useRef<HTMLDivElement>(null);
  const bgGlowRef    = useRef<HTMLDivElement>(null);
  const beatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Outward box-shadow (no inset) — baseline always visible, peak on each beat
  const BASELINE_SHADOW =
    "0 0 0 1.5px rgba(255,20,100,0.45), 0 0 14px rgba(255,20,100,0.30)";
  const PEAK_SHADOW =
    "0 0 0 3px rgba(255,20,100,0.95), 0 0 22px rgba(255,20,100,0.75), 0 0 55px rgba(255,80,140,0.40)";

  // Set baseline ring on mount
  useEffect(() => {
    const ring = ringRef.current;
    if (ring) ring.style.boxShadow = BASELINE_SHADOW;
  }, []);

  useEffect(() => {
    if (beatCount === 0) return;

    if (beatTimerRef.current) clearTimeout(beatTimerRef.current);

    const ring = ringRef.current;
    const bg   = bgGlowRef.current;

    // Fast punch to peak
    if (ring) {
      ring.style.transition = "box-shadow 0.07s ease-in";
      ring.style.boxShadow  = PEAK_SHADOW;
    }
    if (bg) {
      bg.style.transition = "opacity 0.07s ease-in, transform 0.07s ease-in";
      bg.style.opacity    = "0.95";
      bg.style.transform  = "scale(1.07)";
    }

    // Slow breath back to baseline
    beatTimerRef.current = setTimeout(() => {
      if (ring) {
        ring.style.transition = "box-shadow 0.55s ease-out";
        ring.style.boxShadow  = BASELINE_SHADOW;
      }
      if (bg) {
        bg.style.transition = "opacity 0.55s ease-out, transform 0.55s ease-out";
        bg.style.opacity    = "0.55";
        bg.style.transform  = "scale(1)";
      }
    }, 90);
  }, [beatCount]);

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
    <section className="flex h-full min-h-0 flex-col px-7 py-5">
      <div className="relative mb-4 min-h-0 flex-1">
        <div ref={bgGlowRef} className="lafz-beat-glow absolute -inset-3 rounded-[28px] bg-[radial-gradient(ellipse_at_50%_60%,rgba(255,45,120,0.55)_0%,rgba(255,140,66,0.25)_42%,transparent_72%)] blur-[18px]" style={{ opacity: 0.6 }} />

        {/* Beat ring — sibling of the image container, outside overflow-hidden so shadow goes outward */}
        <div ref={ringRef} className="pointer-events-none absolute inset-0 rounded-[22px]" />

        <div className="relative h-full overflow-hidden rounded-[22px] border border-[rgba(255,20,100,0.15)] bg-[#130f20]">
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

          <div className="absolute bottom-3 left-3 inline-flex items-center gap-2 rounded-full border border-[rgba(255,20,100,0.65)] bg-[rgba(255,20,100,0.14)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[#ff6ba8] shadow-[0_0_10px_rgba(255,20,100,0.35)] backdrop-blur-xl">
            <span className="lafz-badge-ring h-1.5 w-1.5 rounded-full bg-[#ff1464] shadow-[0_0_6px_rgba(255,20,100,0.90)]" />
            {playback.isPlaying ? "Playing" : "Paused"}
          </div>
        </div>
      </div>

      {/* Single combined card */}
      <div className="lafz-card flex-shrink-0 p-5">
        <div className="mb-4">
          <h1 className="text-[22px] font-extrabold leading-[1.1] tracking-[-0.9px] text-white [text-shadow:0_0_20px_rgba(255,255,255,0.20)]">{playback.track.title}</h1>
          <p className="mt-1 text-[13px] text-[rgba(255,20,100,0.80)]">{playback.track.artist}</p>
          <p className="mt-0.5 text-[11px] text-white/50">{playback.track.album}</p>
        </div>

        <div className="mb-5">
          <ProgressBar
            currentMs={visualProgressMs}
            totalMs={playback.track.durationMs}
            onSeek={async (positionMs) => {
              await triggerCommand({ action: "seek", positionMs });
            }}
          />
        </div>

        <div className="flex items-center justify-center gap-3">
          {/* Shuffle */}
          <button
            type="button"
            onClick={() => { void triggerCommand({ action: "shuffle", enabled: !playback.shuffleEnabled }); }}
            disabled={pendingAction !== null}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border transition hover:scale-110"
            style={playback.shuffleEnabled ? {
              background: "linear-gradient(135deg,#ff1464,#ff6aaa)",
              border: "1px solid rgba(255,20,100,0.60)",
              color: "#fff",
              boxShadow: "0 0 12px rgba(255,20,100,0.55)"
            } : {
              background: "rgba(6,2,5,0.92)",
              border: "1px solid rgba(255,20,100,0.35)",
              color: "#ff9abf",
              boxShadow: "0 0 6px rgba(255,20,100,0.15)"
            }}
            aria-label="Shuffle"
          >
            <ShuffleIcon />
          </button>
          {/* Previous */}
          <button
            type="button"
            onClick={() => { void triggerCommand({ action: "previous" }); }}
            disabled={pendingAction !== null}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border transition hover:scale-110"
            style={{ background: "rgba(6,2,5,0.92)", border: "1px solid rgba(255,20,100,0.35)", color: "#ff9abf", boxShadow: "0 0 6px rgba(255,20,100,0.15)" }}
            aria-label="Previous"
          >
            <PrevIcon />
          </button>
          {/* Play/Pause */}
          <button
            type="button"
            onClick={() => { void triggerCommand({ action: playback.isPlaying ? "pause" : "play" }); }}
            disabled={pendingAction !== null}
            className="inline-flex h-[52px] w-[52px] items-center justify-center rounded-full text-white transition hover:scale-[1.06]"
            style={{
              background: "linear-gradient(135deg,#ff1464,#ff6aaa)",
              boxShadow: "0 0 0 1px rgba(255,20,100,0.20), 0 0 20px rgba(255,20,100,0.60), 0 0 40px rgba(255,20,100,0.25)"
            }}
            aria-label={playback.isPlaying ? "Pause" : "Play"}
          >
            {playback.isPlaying ? <PauseIcon /> : <PlayIcon />}
          </button>
          {/* Next */}
          <button
            type="button"
            onClick={() => { void triggerCommand({ action: "next" }); }}
            disabled={pendingAction !== null}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border transition hover:scale-110"
            style={{ background: "rgba(6,2,5,0.92)", border: "1px solid rgba(255,20,100,0.35)", color: "#ff9abf", boxShadow: "0 0 6px rgba(255,20,100,0.15)" }}
            aria-label="Next"
          >
            <NextIcon />
          </button>
          {/* Repeat */}
          <button
            type="button"
            onClick={() => { void triggerCommand({ action: "repeat", mode: nextRepeatMode }); }}
            disabled={pendingAction !== null}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border transition hover:scale-110"
            style={playback.repeatMode !== "off" ? {
              background: "linear-gradient(135deg,#ff1464,#ff6aaa)",
              border: "1px solid rgba(255,20,100,0.60)",
              color: "#fff",
              boxShadow: "0 0 12px rgba(255,20,100,0.55)"
            } : {
              background: "rgba(6,2,5,0.92)",
              border: "1px solid rgba(255,20,100,0.35)",
              color: "#ff9abf",
              boxShadow: "0 0 6px rgba(255,20,100,0.15)"
            }}
            aria-label="Repeat"
          >
            <RepeatIcon />
          </button>
        </div>

        {/* Playing on + action buttons */}
        <div className="mt-5 border-t border-[rgba(255,20,100,0.15)] pt-4">
          <p className="mb-3 text-[11px] font-medium text-white/50">
            Playing on <span className="font-semibold text-white">{playback.deviceName ?? "Spotify app"}</span>
          </p>
          <div className="grid gap-2">
            <Link
              href={`/library/track/${playback.track.spotifyTrackId}`}
              className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-[1px]"
              style={{
                border: "1px solid rgba(255,20,100,0.50)",
                boxShadow: "0 0 8px rgba(255,20,100,0.25)",
                textShadow: "0 0 10px rgba(255,20,100,0.55)"
              }}
            >
              <TrackDetailIcon />
              Track detail
            </Link>
            <form action="/api/spotify/logout" method="post" className="w-full">
              <button
                type="submit"
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white/60 transition hover:-translate-y-[1px] hover:text-white"
                style={{
                  border: "1px solid rgba(255,20,100,0.22)",
                  boxShadow: "0 0 5px rgba(255,20,100,0.10)"
                }}
              >
                <DisconnectIcon />
                Disconnect
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
