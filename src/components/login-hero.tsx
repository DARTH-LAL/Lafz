"use client";

import { useSearchParams } from "next/navigation";

const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  invalid_state: "The Spotify sign-in attempt expired before the callback completed. Try connecting again.",
  missing_code: "Spotify returned without an authorization code. Please retry the login flow.",
  missing_env: "Spotify environment variables are missing. Add them to .env.local before logging in.",
  session_expired: "Your Spotify session expired or could not be refreshed. Sign in again to continue.",
  spotify_callback_failed: "Spotify sign-in completed, but Lafz could not save the tokens locally. Please try again.",
  spotify_declined: "Spotify access was declined, so Lafz could not read the current playback state."
};

type LoginHeroProps = {
  canonicalAppOrigin?: string | null;
};

export function LoginHero({ canonicalAppOrigin }: LoginHeroProps) {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error") ?? searchParams.get("reason");
  const errorMessage = errorCode ? LOGIN_ERROR_MESSAGES[errorCode] ?? "Lafz could not finish Spotify sign-in. Please try again." : null;
  const spotifyLoginHref = canonicalAppOrigin ? `${canonicalAppOrigin}/api/spotify/login` : "/api/spotify/login";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center gap-8 px-6 py-12 lg:flex-row lg:items-center lg:px-10">
      <section className="max-w-2xl flex-1">
        <div className="inline-flex items-center gap-3 rounded-full border border-cyan-300/20 bg-cyan-300/8 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-100">
          <span className="h-2 w-2 rounded-full bg-cyan-300" />
          Lafz personal prototype
        </div>

        <h1 className="mt-6 font-display text-5xl font-semibold leading-tight tracking-tight text-white sm:text-6xl">
          Your own translations, synced live to Spotify.
        </h1>

        <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
          Lafz watches the song you are already playing in Spotify, reads its current progress, and renders your own local
          translated lyric lines in time with the music.
        </p>

        <div className="mt-8 flex flex-wrap gap-3 text-sm text-slate-400">
          <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2">Official Spotify auth only</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2">Local JSON translations only</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2">No lyrics scraping or audio downloads</span>
        </div>

        {errorMessage ? (
          <div className="mt-8 rounded-[28px] border border-rose-300/20 bg-rose-300/10 p-5 text-sm leading-7 text-rose-100">
            {errorMessage}
          </div>
        ) : null}
      </section>

      <section className="w-full max-w-xl rounded-[36px] border border-white/10 bg-[color:var(--lafz-panel)] p-8 shadow-[0_28px_100px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300/80">Web MVP</p>
        <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white">
          Connect Spotify and start translating in place.
        </h2>

        <div className="mt-6 space-y-4 rounded-[28px] border border-white/8 bg-white/[0.03] p-5 text-sm leading-7 text-slate-300">
          <p>
            Lafz uses Spotify login, reads your current playback state, and then looks for a matching local file in
            <span className="ml-2 rounded bg-white/8 px-2 py-1 font-mono text-xs text-slate-200">data/translations/local</span>.
          </p>
          <p>
            For local development, configure Spotify with the redirect URI
            <span className="ml-2 rounded bg-white/8 px-2 py-1 font-mono text-xs text-slate-200">
              http://127.0.0.1:3000/api/spotify/callback
            </span>
            .
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a
            href={spotifyLoginHref}
            className="inline-flex flex-1 items-center justify-center rounded-full bg-cyan-300 px-6 py-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
          >
            Connect Spotify
          </a>
          <a
            href="https://developer.spotify.com/dashboard"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/5 px-6 py-4 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
          >
            Open Spotify dashboard
          </a>
        </div>
      </section>
    </main>
  );
}
