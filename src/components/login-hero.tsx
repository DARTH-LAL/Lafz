"use client";

import type { CSSProperties } from "react";
import { useSearchParams } from "next/navigation";

import { AppTopBar } from "@/components/app-top-bar";

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

type TickerItem = {
  language: string;
  original: string;
  translated: string;
};

const tickerItems: TickerItem[] = [
  {
    language: "Punjabi",
    original: "Mai keha yaariyan ch jatta teri meri da ni hunda",
    translated: "Real friendship is not about mine versus yours."
  },
  {
    language: "Hindi",
    original: "Tera hone laga hoon",
    translated: "I am slowly becoming yours."
  },
  {
    language: "Urdu",
    original: "Tu hai kahan",
    translated: "Where are you now?"
  },
  {
    language: "Punjabi",
    original: "Lakk tera patla jeha",
    translated: "Your silhouette moves with effortless grace."
  },
  {
    language: "Hindi",
    original: "Kesariya tera ishq hai piya",
    translated: "Your love colors everything around me."
  }
];

const steps = [
  {
    title: "Connect your music",
    description: "Spotify is ready today, and Apple Music is already being designed into the same flow for the next sync release."
  },
  {
    title: "Match the song instantly",
    description: "Lafz reads the track that is playing and finds the right translation from your own local library automatically."
  },
  {
    title: "Read every line with context",
    description: "Synced songs follow the beat live, while untimed translations still stay readable with original lines, notes, and transliteration."
  }
];

const trustItems = [
  "Official music-service auth",
  "Reads playback, not your library history",
  "Spotify now, Apple Music sync next"
];

const floatingCards = [
  { title: "Lemonade", subtitle: "Punjabi", rotation: "rotate(8deg)" },
  { title: "Winning Speech", subtitle: "Punjabi", rotation: "rotate(-6deg)" },
  { title: "Apple Music", subtitle: "Coming soon", rotation: "rotate(11deg)" }
];

function SpotifyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

function AppleMusicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
      <path d="M17.65 2.22c0 1.4-.57 2.72-1.48 3.64-.95.95-2.17 1.45-3.44 1.35-.09-1.26.44-2.59 1.35-3.5.9-.91 2.35-1.56 3.57-1.49zM20.57 18.62c-.51 1.17-.75 1.69-1.4 2.76-.91 1.5-2.18 3.37-3.76 3.38-1.4.01-1.77-.91-3.67-.9-1.9.01-2.31.92-3.71.91-1.58-.01-2.78-1.7-3.69-3.2-2.55-4.22-2.82-9.17-1.25-11.57 1.12-1.71 2.89-2.71 4.55-2.71 1.7 0 2.76.92 4.16.92 1.36 0 2.18-.92 4.15-.92 1.48 0 3.05.81 4.17 2.2-3.66 2-3.06 7.23.45 9.13z" />
    </svg>
  );
}

function MusicNoteIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7 fill-white/15" aria-hidden="true">
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
    </svg>
  );
}

export function LoginHero({ canonicalAppOrigin }: LoginHeroProps) {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error") ?? searchParams.get("reason");
  const errorMessage = errorCode
    ? LOGIN_ERROR_MESSAGES[errorCode] ?? "Lafz could not finish sign-in. Please try again."
    : null;
  const spotifyLoginHref = canonicalAppOrigin ? `${canonicalAppOrigin}/api/spotify/login` : "/api/spotify/login";
  const showSetupLink = errorCode === "missing_env";
  const repeatedTicker = [...tickerItems, ...tickerItems];

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#070510] text-[#fff0f6] [font-family:var(--font-jakarta)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-[240px] -top-[300px] h-[720px] w-[720px] rounded-full bg-[radial-gradient(circle,rgba(255,45,120,0.12)_0%,transparent_62%)]" />
        <div className="absolute -left-[190px] bottom-[20px] h-[360px] w-[520px] rotate-[-18deg] bg-[radial-gradient(ellipse,rgba(255,140,66,0.08)_0%,transparent_68%)]" />
        <div className="absolute -left-[70px] top-[48%] h-[330px] w-[330px] rounded-full bg-[radial-gradient(circle,rgba(120,50,210,0.07)_0%,transparent_68%)]" />
      </div>

      <div className="lafz-home-fade-in relative z-10 overflow-hidden border-y border-white/6 bg-[rgba(13,11,26,0.54)] py-3 backdrop-blur-xl">
        <div className="lafz-home-ticker flex w-max items-center">
          {repeatedTicker.map((item, index) => (
            <div key={`${item.original}-${index}`} className="flex items-center gap-3 px-7 text-[13px] font-medium text-[#8f7ca7]">
              <span className="rounded-full border border-white/8 bg-white/5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[1.2px] text-[#ff9dbf]">
                {item.language}
              </span>
              <span className="italic text-white/45">{item.original}</span>
              <span className="text-[#ff5c92]">→</span>
              <span className="font-semibold text-[#fff0f6]">{item.translated}</span>
              <span className="h-1 w-1 rounded-full bg-[#ff4f8e]/40" />
            </div>
          ))}
        </div>
      </div>

      <div className="relative z-10 mx-auto max-w-[430px] px-6 pb-16">
        <AppTopBar className="lafz-home-fade-in mt-7" />

        <section className="relative pb-12 pt-14">
          <div className="pointer-events-none absolute right-[-8px] top-6 h-[210px] w-[165px]">
            {floatingCards.map((card, index) => (
              <div
                key={card.title}
                className="lafz-floating-card absolute h-[112px] w-[112px] overflow-hidden rounded-[20px] border border-white/10 shadow-[0_24px_64px_rgba(0,0,0,0.45)]"
                style={{
                  top: `${index * 34}px`,
                  right: index === 1 ? "44px" : index === 2 ? "10px" : "0px",
                  animationDelay: `${index * 0.16}s`,
                  ["--lafz-card-transform" as string]: card.rotation
                } as CSSProperties}
              >
                <div
                  className={`relative flex h-full w-full items-center justify-center ${
                    index === 0
                      ? "bg-[linear-gradient(135deg,#1e0d36_0%,#3d1230_100%)]"
                      : index === 1
                        ? "bg-[linear-gradient(135deg,#0d1a2e_0%,#0d2a1e_100%)]"
                        : "bg-[linear-gradient(135deg,#1a0d30_0%,#2a1548_100%)]"
                  }`}
                >
                  <div
                    className={`absolute inset-0 ${
                      index === 0
                        ? "bg-[radial-gradient(ellipse_at_30%_30%,rgba(255,45,120,0.5),transparent_60%)]"
                        : index === 1
                          ? "bg-[radial-gradient(ellipse_at_60%_40%,rgba(50,200,120,0.38),transparent_60%)]"
                          : "bg-[radial-gradient(ellipse_at_40%_60%,rgba(140,80,255,0.4),transparent_60%)]"
                    }`}
                  />
                  <MusicNoteIcon />
                  <div className="absolute bottom-2 left-2 right-2 truncate rounded-lg bg-black/40 px-2 py-1 text-[9px] font-bold tracking-[0.4px] text-white/90 backdrop-blur-md">
                    {card.title} · {card.subtitle}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="relative z-10 max-w-[270px]">
            <div className="lafz-home-fade-up inline-flex items-center gap-2 rounded-full border border-[#ff2d78]/25 bg-[#ff2d78]/10 px-4 py-2 text-[12px] font-semibold text-[#ff86b6]">
              <span className="lafz-badge-ring h-1.5 w-1.5 rounded-full bg-[#ff2d78]" />
              Lyrics that finally make sense
            </div>

            <h1 className="lafz-home-fade-up mt-7 text-[52px] leading-[1.03] font-extrabold tracking-[-2.7px] text-[#fff0f6]" style={{ animationDelay: "0.12s" }}>
              Understand
              <br />
              every song
              <br />
              <span className="lafz-home-shimmer bg-[linear-gradient(110deg,#ff2d78_0%,#ff8c42_28%,#ffd0df_48%,#ff8c42_68%,#ff2d78_100%)] bg-[length:250%_100%] bg-clip-text text-transparent">
                you love.
              </span>
            </h1>

            <p className="lafz-home-fade-up mt-5 text-[15px] leading-[1.72] font-light text-[#9a85b2]" style={{ animationDelay: "0.22s" }}>
              Lafz reads what&apos;s playing, brings your translations on screen in real time, and is already being shaped for both Spotify now and Apple Music sync next.
            </p>
          </div>
        </section>

        <section id="how-it-works" className="lafz-home-fade-up mt-1 space-y-1" style={{ animationDelay: "0.32s" }}>
          {steps.map((step, index) => (
            <div key={step.title} className="flex gap-4 border-b border-white/7 py-5 last:border-b-0">
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] border border-[#ff8c42]/25 bg-[linear-gradient(135deg,rgba(255,140,66,0.16)_0%,rgba(255,45,120,0.12)_100%)] text-[13px] font-extrabold text-[#ffb178] shadow-[0_10px_24px_rgba(255,140,66,0.08)]">
                {index + 1}
              </div>
              <div>
                <div className="text-[15px] font-bold tracking-[-0.3px] text-[#fff0f6]">{step.title}</div>
                <div className="mt-1 text-[13px] leading-[1.6] font-light text-[#9a85b2]">{step.description}</div>
              </div>
            </div>
          ))}
        </section>

        <section className="lafz-home-fade-up mt-10 rounded-[28px] border border-white/8 bg-[rgba(13,11,26,0.82)] p-6 shadow-[0_30px_90px_rgba(0,0,0,0.42)] backdrop-blur-xl" style={{ animationDelay: "0.42s" }}>
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-[2.2px] text-[#ff7fb4]">Choose your player</div>
          <h2 className="text-[24px] leading-[1.2] font-bold tracking-[-1px] text-[#fff0f6]">
            Start with Spotify today, keep Apple Music in the same Lafz flow tomorrow.
          </h2>
          <p className="mt-3 text-[14px] leading-[1.75] font-light text-[#9a85b2]">
            Spotify is fully live now. Apple Music support is already planned into the product language, library matching, and synced translation experience so your workflow stays familiar when it arrives.
          </p>

          <div className="mt-6 grid gap-3">
            <a
              href={spotifyLoginHref}
              className="relative inline-flex items-center justify-center gap-3 overflow-hidden rounded-[20px] bg-[linear-gradient(135deg,#ff2d78_0%,#ff8c42_100%)] px-5 py-[18px] text-[16px] font-bold text-white transition hover:-translate-y-0.5 hover:opacity-95"
            >
              <span className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.1),transparent)]" />
              <span className="relative flex items-center gap-3">
                <SpotifyIcon />
                Continue with Spotify
              </span>
            </a>

            <button
              type="button"
              disabled
              aria-disabled="true"
              className="inline-flex items-center justify-center gap-3 rounded-[20px] border border-white/12 bg-white/[0.03] px-5 py-[18px] text-[15px] font-semibold text-[#fff0f6]/65"
            >
              <AppleMusicIcon />
              Apple Music sync coming soon
            </button>
          </div>

          {showSetupLink ? (
            <a
              href="https://developer.spotify.com/dashboard"
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex text-[12px] font-medium text-[#ff9dc1] underline decoration-[#ff5c92]/40 underline-offset-4"
            >
              Need local Spotify setup? Open the dashboard.
            </a>
          ) : null}
        </section>

        <section className="lafz-home-fade-up flex flex-wrap items-center gap-3 pt-8 text-[12px] font-medium text-[#9a85b2]" style={{ animationDelay: "0.52s" }}>
          {trustItems.map((item, index) => (
            <div key={item} className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-[#ff5c92]/70" />
                <span>{item}</span>
              </div>
              {index < trustItems.length - 1 ? <span className="h-1 w-1 rounded-full bg-white/15" /> : null}
            </div>
          ))}
        </section>

        {errorMessage ? (
          <div className="lafz-home-fade-up mt-7 rounded-[22px] border border-[#ff2d78]/20 bg-[#ff2d78]/10 px-5 py-4 text-sm leading-7 text-[#fff0f6]" style={{ animationDelay: "0.58s" }}>
            {errorMessage}
          </div>
        ) : null}
      </div>
    </main>
  );
}
