"use client";

import Image from "next/image";
import { useSpotifyWebPlayer } from "@/hooks/use-spotify-web-player";

export function ConsumerPlayer() {
  const { state, controls } = useSpotifyWebPlayer();

  if (!state.isReady) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="mb-3 text-4xl">🎵</div>
          <p className="text-sm text-white/60">Connecting to Spotify...</p>
          <p className="mt-1 text-xs text-white/30">Open Spotify and start playing a song</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-8">
      {/* Album Art with breathing glow */}
      <div className="relative">
        <div
          className="pointer-events-none absolute inset-0 rounded-[22px]"
          style={{
            animation: state.isPlaying
              ? "lafz-ring-breathe 2.4s ease-in-out infinite"
              : "none",
            boxShadow: "0 0 0 1.5px rgba(255,20,100,0.30), 0 0 10px rgba(255,20,100,0.15)",
          }}
        />
        <div className="relative h-64 w-64 overflow-hidden rounded-[22px] bg-[#130f20]">
          {state.albumArtUrl ? (
            <Image
              src={state.albumArtUrl}
              alt="Album art"
              fill
              className="object-cover"
              sizes="256px"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <svg viewBox="0 0 24 24" className="h-16 w-16 fill-white/20">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
            </div>
          )}
        </div>
      </div>

      {/* Track info */}
      <div className="text-center">
        <h2 className="text-xl font-bold text-white">
          {state.trackName ?? "Nothing playing"}
        </h2>
        <p className="mt-1 text-sm text-[rgba(255,20,100,0.80)]">
          {state.artistName ?? "Open Spotify to play"}
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <button
          onClick={controls.previous}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(255,20,100,0.35)] text-[#ff9abf] transition hover:scale-110"
          style={{ background: "rgba(6,2,5,0.92)" }}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
            <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
          </svg>
        </button>

        <button
          onClick={controls.togglePlay}
          className="flex h-14 w-14 items-center justify-center rounded-full text-white transition hover:scale-105"
          style={{
            background: "linear-gradient(135deg,#ff1464,#ff6aaa)",
            boxShadow: "0 0 20px rgba(255,20,100,0.60)",
          }}
        >
          {state.isPlaying ? (
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
              <path d="M6 19h4V5H6v14Zm8-14v14h4V5h-4Z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
              <path d="m8 5 11 7L8 19V5Z" />
            </svg>
          )}
        </button>

        <button
          onClick={controls.next}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-[rgba(255,20,100,0.35)] text-[#ff9abf] transition hover:scale-110"
          style={{ background: "rgba(6,2,5,0.92)" }}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
            <path d="M16 6h2v12h-2zm-1.5 6L6 18V6z" />
          </svg>
        </button>
      </div>

      {/* Device ID badge — confirms SDK is working */}
      <p className="text-[10px] text-white/20">
        Device: {state.deviceId?.slice(0, 8)}...
      </p>
    </div>
  );
}
