"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { FloatingToast } from "@/components/floating-toast";

type LyricsAutoFetchButtonProps = {
  track: {
    spotifyTrackId: string;
    title: string;
    artist: string;
    album: string;
    durationMs: number;
  };
  alreadyHasLyrics: boolean;
};

type FetchState = "idle" | "loading" | "success_synced" | "success_plain" | "not_found" | "error";

export function LyricsAutoFetchButton({ track, alreadyHasLyrics }: LyricsAutoFetchButtonProps) {
  const router = useRouter();
  const [fetchState, setFetchState] = useState<FetchState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const isSuccess = fetchState === "success_synced" || fetchState === "success_plain";
  const isError = fetchState === "not_found" || fetchState === "error";

  function showToast(msg: string, tone: "success" | "error") {
    setToast({ message: msg, tone });
    window.setTimeout(() => setToast(null), 4000);
  }

  async function handleFetch() {
    setFetchState("loading");
    setMessage(null);

    try {
      const formData = new FormData();
      formData.set("spotifyTrackId", track.spotifyTrackId);
      formData.set("title", track.title);
      formData.set("artist", track.artist);
      formData.set("album", track.album);
      formData.set("durationMs", track.durationMs.toString());

      const response = await fetch("/api/lyrics/fetch", {
        method: "POST",
        body: formData
      });

      const payload = (await response.json()) as {
        success?: boolean;
        status?: string;
        message?: string;
        error?: string;
      };

      if (payload.status === "fetched_synced") {
        setFetchState("success_synced");
        setMessage(payload.message ?? "Synced lyrics fetched.");
        showToast(payload.message ?? "Synced lyrics fetched.", "success");
        router.refresh();
        return;
      }

      if (payload.status === "fetched_plain") {
        setFetchState("success_plain");
        setMessage(payload.message ?? "Plain lyrics fetched.");
        showToast(payload.message ?? "Plain lyrics fetched.", "success");
        router.refresh();
        return;
      }

      if (payload.status === "not_found") {
        setFetchState("not_found");
        setMessage(payload.message ?? "No lyrics found on lrclib or Genius.");
        showToast(payload.message ?? "No lyrics found.", "error");
        return;
      }

      throw new Error(payload.error ?? payload.message ?? "Unknown fetch error.");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Lafz could not auto-fetch lyrics right now.";
      setFetchState("error");
      setMessage(msg);
      showToast(msg, "error");
    }
  }

  return (
    <>
      {toast ? <FloatingToast message={toast.message} tone={toast.tone} /> : null}

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => void handleFetch()}
          disabled={fetchState === "loading" || isSuccess}
          className={`inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
            isSuccess
              ? "border border-[rgba(255,45,120,0.3)] bg-[rgba(255,45,120,0.12)] text-[#fff0f6]"
              : "border border-white/12 bg-white/5 text-slate-100 hover:bg-white/10"
          }`}
        >
          {fetchState === "loading" ? (
            <>
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Searching lrclib &amp; Genius…
            </>
          ) : fetchState === "success_synced" ? (
            "✓ Synced lyrics saved"
          ) : fetchState === "success_plain" ? (
            "✓ Plain lyrics saved"
          ) : alreadyHasLyrics ? (
            "Re-fetch lyrics automatically"
          ) : (
            "Auto-fetch lyrics"
          )}
        </button>

        {message && !toast ? (
          <p
            className={`rounded-[18px] px-4 py-3 text-xs leading-6 ${
              isError
                ? "border border-amber-300/20 bg-amber-300/10 text-amber-100"
                : "border border-[rgba(255,45,120,0.2)] bg-[rgba(255,45,120,0.09)] text-[#fff0f6]"
            }`}
          >
            {message}
          </p>
        ) : null}
      </div>
    </>
  );
}
