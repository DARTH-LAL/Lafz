import Image from "next/image";

import type { PlaybackState } from "@/features/spotify/types";
import type { TrackTranslation } from "@/features/translations/types";
import { ProgressBar } from "@/components/progress-bar";

type PlayerCardProps = {
  playback: PlaybackState;
  visualProgressMs: number;
  translation: TrackTranslation | null;
};

export function PlayerCard({ playback, visualProgressMs, translation }: PlayerCardProps) {
  if (!playback.track) {
    return null;
  }

  return (
    <section className="rounded-[32px] border border-white/10 bg-[color:var(--lafz-panel-strong)] p-6 shadow-[0_28px_100px_rgba(0,0,0,0.4)] backdrop-blur-xl lg:sticky lg:top-8">
      <div className="relative aspect-square overflow-hidden rounded-[28px] border border-white/10 bg-slate-900/80">
        {playback.track.albumArtUrl ? (
          <Image
            src={playback.track.albumArtUrl}
            alt={`${playback.track.album} album art`}
            fill
            priority
            className="object-cover"
            sizes="(max-width: 1024px) 100vw, 420px"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.25),_transparent_45%),linear-gradient(180deg,_rgba(12,20,38,1)_0%,_rgba(3,6,13,1)_100%)]">
            <span className="font-display text-3xl text-slate-400">Lafz</span>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent p-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/[0.35] px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-cyan-200/90">
            <span className="h-2 w-2 rounded-full bg-cyan-300" />
            {playback.playbackStateLabel}
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-slate-500">Now playing</p>
          <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white">
            {playback.track.title}
          </h1>
          <p className="mt-2 text-lg text-slate-300">{playback.track.artist}</p>
          <p className="mt-2 text-sm text-slate-500">{playback.track.album}</p>
        </div>

        <ProgressBar currentMs={visualProgressMs} totalMs={playback.track.durationMs} />

        <div className="grid gap-3 rounded-[24px] border border-white/8 bg-white/[0.04] p-4 text-sm text-slate-300 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Device</p>
            <p className="mt-2 text-base text-white">{playback.deviceName ?? "Spotify app"}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Translation</p>
            <p className="mt-2 text-base text-white">
              {translation ? `${translation.sourceLanguage} -> ${translation.targetLanguage}` : "Not available yet"}
            </p>
          </div>
        </div>

        <div className="rounded-[24px] border border-dashed border-white/12 bg-black/10 p-4 text-sm text-slate-400">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Spotify track ID</p>
          <p className="mt-2 break-all font-mono text-xs text-slate-300">{playback.track.spotifyTrackId}</p>
        </div>

        <div className="flex flex-wrap gap-3">
          {playback.track.externalUrl ? (
            <a
              href={playback.track.externalUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-300/10 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200/50 hover:bg-cyan-300/15"
            >
              Open in Spotify
            </a>
          ) : null}

          <form action="/api/spotify/logout" method="post">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
            >
              Disconnect
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
