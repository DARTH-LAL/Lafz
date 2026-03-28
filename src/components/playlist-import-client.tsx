"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { AnimatedBackground } from "@/components/animated-background";
import { AppTopBar } from "@/components/app-top-bar";
import type {
  LyricsAutoFetchResult,
  PlaylistImportApiResponse,
  PlaylistImportResult,
  TrackImportApiResponse,
  TrackImportResult
} from "@/features/spotify/types";

type DetectedType = "playlist" | "track" | "unknown";

function detectInputType(input: string): DetectedType {
  const trimmed = input.trim();
  if (!trimmed) return "unknown";
  if (trimmed.includes("spotify.com/playlist/") || trimmed.includes("playlist/")) return "playlist";
  if (trimmed.includes("spotify.com/track/") || trimmed.includes("track/")) return "track";
  return "unknown";
}

export function PlaylistImportClient() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [manualType, setManualType] = useState<"playlist" | "track">("playlist");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [playlistSummary, setPlaylistSummary] = useState<PlaylistImportResult | null>(null);
  const [trackSummary, setTrackSummary] = useState<TrackImportResult | null>(null);
  const [lyricsAutoFetch, setLyricsAutoFetch] = useState<LyricsAutoFetchResult | null>(null);

  const detected = detectInputType(input);
  const resolvedType: "playlist" | "track" = detected === "unknown" ? manualType : detected;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    setErrorMessage(null);
    setPlaylistSummary(null);
    setTrackSummary(null);
    setLyricsAutoFetch(null);

    try {
      if (resolvedType === "playlist") {
        const response = await fetch("/api/library/import-playlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playlistInput: input })
        });
        const payload = (await response.json()) as PlaylistImportApiResponse;
        if (!payload.success) throw new Error(payload.error);
        setPlaylistSummary(payload.summary);
        setStatus("success");
      } else {
        const response = await fetch("/api/library/import-track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trackInput: input })
        });
        const payload = (await response.json()) as TrackImportApiResponse;
        if (!payload.success) throw new Error(payload.error);
        setTrackSummary(payload.summary);
        setLyricsAutoFetch(payload.lyricsAutoFetch);
        setStatus("success");
        router.push(`/library/track/${payload.summary.trackId}`);
      }
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Import failed.");
    }
  }

  return (
    <main className="relative min-h-screen w-full overflow-x-hidden text-[#fff0f6]">
      <AnimatedBackground />
      <div className="relative z-10 mx-auto max-w-6xl px-6 py-8 lg:px-10">
        <AppTopBar connected className="mb-8" />

        {/* Header */}
        <header className="mb-10">
          <div className="mb-4 flex items-center gap-3">
            <div className="h-0.5 w-7 rounded-full bg-[linear-gradient(90deg,#ff1464,transparent)] shadow-[0_0_8px_#ff1464]" />
            <p className="text-[11px] font-bold uppercase tracking-[2.5px] text-[#ff1464] [text-shadow:0_0_16px_rgba(255,20,100,0.6)]">
              Lafz Library Tools
            </p>
          </div>
          <h1 className="font-display text-5xl font-extrabold leading-[1.06] tracking-[-2px] text-white [text-shadow:0_0_30px_rgba(255,255,255,0.30),0_0_70px_rgba(255,255,255,0.12)]">
            Import your music
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: "linear-gradient(110deg,#ff1464 0%,#ff6aaa 25%,#ffffff 48%,#ff6aaa 68%,#ff1464 100%)",
                backgroundSize: "250% 100%",
                animation: "lafz-shimmer 3.5s linear infinite"
              }}
            >
              into Lafz.
            </span>
          </h1>
        </header>

        <div className="grid gap-6 lg:grid-cols-[440px_1fr] lg:items-start">

          {/* Left: unified import form */}
          <section className="lafz-card p-7">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[2.2px] text-[rgba(255,20,100,0.65)]">Import</p>
            <h2 className="mb-3 font-display text-[26px] font-extrabold leading-[1.15] tracking-[-0.8px] text-white [text-shadow:0_0_30px_rgba(255,255,255,0.30),0_0_70px_rgba(255,255,255,0.12)]">
              Paste a playlist or track link.
            </h2>
            <p className="text-[14px] leading-[1.75] text-white [text-shadow:0_0_16px_rgba(255,255,255,0.55),0_0_40px_rgba(255,255,255,0.20)]">
              Lafz automatically detects whether it&apos;s a playlist or a single song from the URL.
            </p>

            <div className="mt-4 rounded-[16px] border border-[rgba(255,160,30,0.20)] bg-[rgba(255,160,30,0.08)] p-4 text-[13px] leading-[1.65] text-[#ffc87a]">
              ⚠ Spotify&apos;s Development Mode may block public playlists you don&apos;t own. If you see a{" "}
              <code className="mx-1 rounded-[6px] bg-black/25 px-2 py-0.5 font-mono text-[11px]">403 Forbidden</code>
              {" "}error, copy it to your own library first.
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <label className="block">
                <span className="mb-2 block text-[12px] font-bold uppercase tracking-[1px] text-[rgba(255,20,100,0.70)]">
                  Spotify URL or ID
                </span>
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="https://open.spotify.com/playlist/… or /track/…"
                  className="w-full rounded-[14px] border border-[rgba(255,20,100,0.16)] bg-[rgba(255,20,100,0.05)] px-4 py-3 text-[14px] text-white outline-none transition placeholder:text-white focus:border-[rgba(255,20,100,0.50)] focus:shadow-[0_0_0_3px_rgba(255,20,100,0.10)]"
                />
              </label>

              {/* Detection indicator */}
              <div className="flex items-center gap-3">
                {detected !== "unknown" ? (
                  <div className="flex items-center gap-2 rounded-full border border-[rgba(255,20,100,0.25)] bg-[rgba(255,20,100,0.10)] px-3 py-1.5 text-[12px] font-semibold text-[#ff6aaa]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#ff1464] shadow-[0_0_6px_#ff1464]" />
                    Detected: {detected === "playlist" ? "Playlist" : "Single track"}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] text-white">Import as:</span>
                    <div className="flex rounded-full border border-[rgba(255,20,100,0.16)] bg-[rgba(255,20,100,0.05)] p-0.5">
                      {(["playlist", "track"] as const).map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setManualType(type)}
                          className={`rounded-full px-4 py-1.5 text-[12px] font-semibold capitalize transition ${
                            manualType === type
                              ? "bg-[linear-gradient(135deg,#ff1464,#ff6aaa)] text-white shadow-[0_0_12px_rgba(255,20,100,0.35)]"
                              : "text-white hover:text-[#ff6aaa]"
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={status === "submitting" || !input.trim()}
                className="w-full rounded-full bg-[linear-gradient(135deg,#ff1464,#ff6aaa)] py-3.5 text-[15px] font-bold text-white shadow-[0_0_28px_rgba(255,20,100,0.40)] transition hover:opacity-90 hover:shadow-[0_0_40px_rgba(255,20,100,0.60)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === "submitting"
                  ? resolvedType === "playlist" ? "Importing playlist…" : "Importing & fetching lyrics…"
                  : resolvedType === "playlist" ? "Import Playlist" : "Import Song"}
              </button>
            </form>

            {status === "error" && errorMessage ? (
              <div className="mt-4 rounded-[14px] border border-[rgba(255,20,100,0.25)] bg-[rgba(255,20,100,0.08)] p-4 text-[13px] text-[#ff6aaa]">
                {errorMessage}
              </div>
            ) : null}

            {playlistSummary ? (
              <div className="mt-5 space-y-3">
                <p className="text-[11px] font-bold uppercase tracking-[2px] text-[rgba(255,20,100,0.65)]">Import complete — {playlistSummary.playlistName}</p>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Tracks fetched", value: playlistSummary.totalTracksFetched },
                    { label: "Imported", value: playlistSummary.importedCount },
                    { label: "Skipped", value: playlistSummary.skippedCount },
                    { label: "Files created", value: playlistSummary.translationFilesCreatedCount }
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-[14px] border border-[rgba(255,20,100,0.12)] bg-[rgba(255,20,100,0.05)] p-3">
                      <p className="text-[10px] uppercase tracking-[1.5px] text-[rgba(255,20,100,0.55)]">{stat.label}</p>
                      <p className="mt-1 text-[22px] font-extrabold text-[#ff4d96] [text-shadow:0_0_20px_rgba(255,20,100,0.4)]">{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {/* Right: what happens */}
          <div>
            <div className="lafz-card p-7">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[2.2px] text-[rgba(255,20,100,0.65)]">What happens when you import</p>
              <h3 className="mb-2 text-[22px] font-bold tracking-[-0.5px]">Instant, local, private.</h3>
              <p className="mb-6 text-[13px] leading-[1.7] text-white">
                Everything stays on your machine. No data leaves Lafz except the Spotify API call to fetch track metadata.
              </p>

              <div className="space-y-3">
                {[
                  { icon: "🎵", title: "Tracks are fetched from Spotify", desc: "Lafz reads the playlist or track metadata using your connected Spotify account." },
                  { icon: "🗂", title: "Duplicates are merged automatically", desc: "Songs appearing in multiple playlists are deduplicated by Spotify track ID." },
                  { icon: "📝", title: "Translation files are created", desc: "A local translation stub is written for every new track, ready for lyric and AI work." },
                  { icon: "✨", title: "Queue is ready immediately", desc: "Head to the Library Queue to see all imported songs and start translating." }
                ].map((step) => (
                  <div
                    key={step.title}
                    className="flex items-start gap-4 rounded-[16px] border border-[rgba(255,20,100,0.10)] bg-[rgba(255,20,100,0.04)] p-4 transition hover:border-[rgba(255,20,100,0.20)] hover:bg-[rgba(255,20,100,0.08)]"
                  >
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px] border border-[rgba(255,20,100,0.22)] bg-[rgba(255,20,100,0.12)] text-[16px]">
                      {step.icon}
                    </div>
                    <div>
                      <p className="text-[13px] font-bold text-[#fff0f6]">{step.title}</p>
                      <p className="mt-0.5 text-[12px] leading-[1.6] text-white">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 space-y-2">
                {[
                  "Only playlists you own or collaborate on can be imported",
                  "Existing translation files are never overwritten",
                  "Single-song imports automatically fetch lyrics if available"
                ].map((tip) => (
                  <div key={tip} className="flex items-center gap-3 rounded-[12px] border border-white/[0.05] bg-white/[0.02] px-4 py-3 text-[12px] text-white">
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#ff1464] shadow-[0_0_6px_#ff1464]" />
                    {tip}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`@keyframes lafz-shimmer { to { background-position: -250% 0; } }`}</style>
    </main>
  );
}
