"use client";

import { useSearchParams } from "next/navigation";
import { AnimatedBackground } from "@/components/animated-background";

const LOGIN_ERROR_MESSAGES: Record<string, string> = {
  invalid_state: "The Spotify sign-in attempt expired before the callback completed. Try connecting again.",
  missing_code: "Spotify returned without an authorization code. Please retry the login flow.",
  missing_env: "Spotify environment variables are missing. Add them to .env.local before logging in.",
  session_expired: "Your Spotify session expired or could not be refreshed. Sign in again to continue.",
  spotify_callback_failed: "Spotify sign-in completed, but LAFZ could not save the tokens locally. Please try again.",
  spotify_declined: "Spotify access was declined, so LAFZ could not read the current playback state."
};

type LoginHeroProps = {
  canonicalAppOrigin?: string | null;
};

// ── Falling lyrical rain ──────────────────────────────────────────────────────

const PINK_SHADES = ["#ff1464", "#ff2d78", "#ff6ba8", "#ff9dc1", "#c2185b", "#ff4d8b", "#e91e8c"];

const RAIN_DROPS = [
  { text: "ਦਿਲ",     left: 4,  delay: 0.0,  dur: 9.2,  size: 13, opacity: 0.22, rot: -6,  shade: 2 },
  { text: "♪",       left: 10, delay: 1.4,  dur: 7.8,  size: 16, opacity: 0.28, rot:  4,  shade: 0 },
  { text: "yaar",    left: 17, delay: 3.1,  dur: 11.0, size: 11, opacity: 0.18, rot: -10, shade: 4 },
  { text: "ਇਸ਼ਕ",    left: 24, delay: 0.7,  dur: 8.5,  size: 12, opacity: 0.22, rot:  7,  shade: 1 },
  { text: "♫",       left: 31, delay: 2.3,  dur: 10.2, size: 15, opacity: 0.26, rot: -4,  shade: 6 },
  { text: "दिल",     left: 38, delay: 4.6,  dur: 9.0,  size: 13, opacity: 0.20, rot:  9,  shade: 3 },
  { text: "ishq",    left: 44, delay: 1.1,  dur: 12.5, size: 10, opacity: 0.17, rot: -7,  shade: 5 },
  { text: "ਯਾਰ",     left: 51, delay: 3.8,  dur: 8.0,  size: 14, opacity: 0.24, rot:  5,  shade: 0 },
  { text: "♩",       left: 57, delay: 0.4,  dur: 11.8, size: 17, opacity: 0.28, rot: -9,  shade: 2 },
  { text: "प्यार",   left: 63, delay: 2.9,  dur: 9.6,  size: 12, opacity: 0.20, rot:  6,  shade: 4 },
  { text: "sajjan",  left: 70, delay: 5.2,  dur: 8.8,  size: 10, opacity: 0.17, rot: -5,  shade: 1 },
  { text: "ਸੱਜਣ",    left: 76, delay: 1.7,  dur: 10.5, size: 13, opacity: 0.22, rot:  8,  shade: 6 },
  { text: "♬",       left: 82, delay: 3.4,  dur: 7.5,  size: 16, opacity: 0.26, rot: -3,  shade: 3 },
  { text: "dil",     left: 88, delay: 0.9,  dur: 9.9,  size: 11, opacity: 0.19, rot:  7,  shade: 5 },
  { text: "ਮੁਹੱਬਤ",  left: 94, delay: 4.0,  dur: 11.3, size: 11, opacity: 0.17, rot: -8,  shade: 0 },
  { text: "♪",       left: 7,  delay: 6.1,  dur: 8.2,  size: 14, opacity: 0.24, rot:  4,  shade: 2 },
  { text: "ranjha",  left: 20, delay: 7.3,  dur: 10.0, size: 10, opacity: 0.18, rot: -6,  shade: 4 },
  { text: "ਰਾਂਝਾ",   left: 34, delay: 5.8,  dur: 9.4,  size: 13, opacity: 0.21, rot:  9,  shade: 6 },
  { text: "♫",       left: 48, delay: 6.6,  dur: 12.0, size: 15, opacity: 0.25, rot: -4,  shade: 1 },
  { text: "mohabbat",left: 61, delay: 8.0,  dur: 8.7,  size: 10, opacity: 0.17, rot:  6,  shade: 3 },
  { text: "ਨਾਮ",     left: 73, delay: 7.1,  dur: 9.1,  size: 12, opacity: 0.21, rot: -7,  shade: 5 },
  { text: "♩",       left: 86, delay: 5.5,  dur: 11.5, size: 16, opacity: 0.26, rot:  5,  shade: 0 },
  { text: "waris",   left: 14, delay: 9.2,  dur: 10.8, size: 10, opacity: 0.18, rot: -9,  shade: 2 },
  { text: "ਵਾਰਿਸ",   left: 42, delay: 8.7,  dur: 9.7,  size: 12, opacity: 0.21, rot:  7,  shade: 4 },
  { text: "♬",       left: 67, delay: 9.8,  dur: 8.4,  size: 15, opacity: 0.25, rot: -3,  shade: 6 },
];

function LyricsRain() {
  return (
    <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden" aria-hidden="true">
      {RAIN_DROPS.map((drop, i) => (
        <span
          key={i}
          className="absolute select-none font-bold"
          style={{
            left: `${drop.left}%`,
            top: 0,
            fontSize: `${drop.size}px`,
            color: PINK_SHADES[drop.shade],
            "--rain-rot": `${drop.rot}deg`,
            "--rain-opacity": drop.opacity,
            animation: `lafz-rain-fall ${drop.dur}s linear ${drop.delay}s infinite`,
            animationFillMode: "backwards",
            willChange: "transform, opacity",
          } as React.CSSProperties}
        >
          {drop.text}
        </span>
      ))}
    </div>
  );
}

function SpotifyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current flex-shrink-0" aria-hidden="true">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

function AppleMusicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current flex-shrink-0" aria-hidden="true">
      <path d="M17.65 2.22c0 1.4-.57 2.72-1.48 3.64-.95.95-2.17 1.45-3.44 1.35-.09-1.26.44-2.59 1.35-3.5.9-.91 2.35-1.56 3.57-1.49zM20.57 18.62c-.51 1.17-.75 1.69-1.4 2.76-.91 1.5-2.18 3.37-3.76 3.38-1.4.01-1.77-.91-3.67-.9-1.9.01-2.31.92-3.71.91-1.58-.01-2.78-1.7-3.69-3.2-2.55-4.22-2.82-9.17-1.25-11.57 1.12-1.71 2.89-2.71 4.55-2.71 1.7 0 2.76.92 4.16.92 1.36 0 2.18-.92 4.15-.92 1.48 0 3.05.81 4.17 2.2-3.66 2-3.06 7.23.45 9.13z" />
    </svg>
  );
}

export function LoginHero({ canonicalAppOrigin }: LoginHeroProps) {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error") ?? searchParams.get("reason");
  const errorMessage = errorCode
    ? LOGIN_ERROR_MESSAGES[errorCode] ?? "LAFZ could not finish sign-in. Please try again."
    : null;
  const spotifyLoginHref = canonicalAppOrigin
    ? `${canonicalAppOrigin}/api/spotify/login`
    : "/api/spotify/login";
  const showSetupLink = errorCode === "missing_env";

  return (
    <main className="relative h-[100dvh] overflow-hidden text-[#fff0f6] [font-family:var(--font-jakarta)]">
      <AnimatedBackground />
      <LyricsRain />

      <div className="relative z-10 flex h-full flex-col">

        {/* Logo nav */}
        <nav className="flex flex-shrink-0 items-center px-12 py-5">
          <span
            className="text-[36px] font-extrabold tracking-[-1.5px] text-[#fff0f6]"
            style={{ textShadow: "0 0 18px rgba(255,255,255,0.12)" }}
          >
            la
            <span
              className="bg-[linear-gradient(135deg,#ff1464_0%,#ff6ba8_100%)] bg-clip-text text-transparent"
              style={{ filter: "drop-shadow(0 0 8px rgba(255,20,100,0.7))" }}
            >
              F
            </span>
            z
          </span>
        </nav>

        {/* Hero content */}
        <div className="mx-auto flex w-full max-w-[600px] flex-1 flex-col items-center justify-center px-12 text-center">
          <div className="flex flex-col items-center">
            {/* Badge */}
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[rgba(255,20,100,0.25)] bg-[rgba(255,20,100,0.10)] px-4 py-[5px] text-[11px] font-bold text-[#ff6ba8]">
              <span
                className="h-1.5 w-1.5 rounded-full bg-[#ff1464]"
                style={{ animation: "lafz-pulse 2s ease-in-out infinite" }}
              />
              Lyrics that finally make sense
            </div>

            {/* Title */}
            <h1
              className="mb-5 font-extrabold leading-[1.04] text-white"
              style={{ fontSize: "clamp(38px, 4.2vw, 58px)", letterSpacing: "-2.5px" }}
            >
              Every song,<br />
              <span
                className="bg-[linear-gradient(110deg,#ff1464_0%,#ff8c42_38%,#ffd0df_52%,#ff8c42_68%,#ff1464_100%)] bg-clip-text text-transparent"
                style={{ backgroundSize: "250% 100%", animation: "lafz-shimmer 3.5s linear infinite" }}
              >
                understood.
              </span>
            </h1>

            {/* Sub */}
            <p
              className="mb-8 max-w-[400px] text-center font-light leading-[1.70] text-white"
              style={{ fontSize: "15px" }}
            >
              LAFZ syncs with what you&apos;re playing and shows{" "}
              <strong className="font-semibold" style={{ color: "#ff1464" }}>real translations</strong>{" "}
              — line by line, beat by beat. Hindi, Punjabi, Urdu and more.
            </p>

            {/* Actions */}
            <div className="flex max-w-[340px] flex-col gap-3">
              <a
                href={spotifyLoginHref}
                className="inline-flex items-center justify-center gap-3 rounded-full bg-[linear-gradient(135deg,#ff1464,#ff6aaa)] px-7 py-[15px] text-[15px] font-bold text-white shadow-[0_0_24px_rgba(255,20,100,0.40)] transition hover:-translate-y-0.5 hover:opacity-90 hover:shadow-[0_0_36px_rgba(255,20,100,0.60)]"
              >
                <SpotifyIcon />
                Continue with Spotify
              </a>

              <button
                type="button"
                disabled
                className="inline-flex items-center justify-center gap-3 rounded-[16px] border border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.04)] px-7 py-[14px] text-[14px] font-semibold text-white/60"
              >
                <AppleMusicIcon />
                Apple Music — coming soon
              </button>
            </div>

            {/* Trust */}
            <div className="mt-5 flex items-center justify-center gap-5">
              {["No library access", "Free to use", "Spotify live now"].map((item) => (
                <div key={item} className="flex items-center gap-1.5 text-[11px] font-medium text-white">
                  <span className="text-[#ff1464]">✦</span>
                  {item}
                </div>
              ))}
            </div>

            {/* Error */}
            {errorMessage && (
              <div className="mt-6 rounded-[18px] border border-[rgba(255,45,120,0.20)] bg-[rgba(255,45,120,0.10)] px-5 py-4 text-[13px] leading-[1.7] text-[#fff0f6]">
                {errorMessage}
              </div>
            )}
            {showSetupLink && (
              <a
                href="https://developer.spotify.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex text-[12px] font-medium text-[#ff9dc1] underline decoration-[#ff5c92]/40 underline-offset-4"
              >
                Need local Spotify setup? Open the dashboard.
              </a>
            )}
          </div>
        </div>

      </div>
    </main>
  );
}
