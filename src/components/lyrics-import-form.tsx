"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { FloatingToast } from "@/components/floating-toast";

type LyricsImportFormProps = {
  track: {
    spotifyTrackId: string;
    title: string;
    artist: string;
    album: string;
    durationMs: number;
  };
  initialMessage: string | null;
  initialStatus: string;
};

export function LyricsImportForm({ track, initialMessage, initialStatus }: LyricsImportFormProps) {
  const router = useRouter();
  const [lyricsText, setLyricsText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState(initialMessage);
  const [messageTone, setMessageTone] = useState<"success" | "error">(initialStatus === "local_error" ? "error" : "success");
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(
    initialMessage ? { message: initialMessage, tone: initialStatus === "local_error" ? "error" : "success" } : null
  );

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 3500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  useEffect(() => {
    if (!initialMessage) {
      return;
    }

    setMessage(initialMessage);
    setMessageTone(initialStatus === "local_error" ? "error" : "success");
  }, [initialMessage, initialStatus]);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.set("spotifyTrackId", track.spotifyTrackId);
      formData.set("title", track.title);
      formData.set("artist", track.artist);
      formData.set("album", track.album);
      formData.set("durationMs", track.durationMs.toString());
      formData.set("lyricsText", lyricsText);

      const response = await fetch("/api/lyrics/import", {
        method: "POST",
        headers: {
          "x-lafz-response": "json"
        },
        body: formData
      });

      const payload = (await response.json()) as {
        success?: boolean;
        status?: string;
        message?: string;
        error?: string;
      };

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? payload.message ?? "Could not import local lyrics.");
      }

      const nextMessage = payload.message ?? "Lafz saved your local lyrics import.";
      setMessage(nextMessage);
      setMessageTone("success");
      setToast({
        message: nextMessage,
        tone: "success"
      });
      setLyricsText("");
      router.refresh();
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Could not import local lyrics.";
      setMessage(nextMessage);
      setMessageTone("error");
      setToast({
        message: nextMessage,
        tone: "error"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {toast ? <FloatingToast message={toast.message} tone={toast.tone} /> : null}

      {message ? (
        <div
          className={`mt-5 rounded-[22px] p-4 text-sm leading-7 ${
            messageTone === "error"
              ? "border border-amber-300/20 bg-amber-300/10 text-amber-100"
              : "border border-[rgba(255,45,120,0.2)] bg-[rgba(255,45,120,0.09)] text-[#fff0f6]"
          }`}
        >
          {message}
        </div>
      ) : null}

      <div className="mt-6 space-y-4">
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Lyrics text</span>
          <textarea
            value={lyricsText}
            onChange={(event) => {
              setLyricsText(event.target.value);
            }}
            rows={10}
            placeholder={`[00:12.34] Example timed line
[00:16.40] Another line

or plain lyrics text

or synced JSON`}
            className="mt-3 w-full rounded-[22px] border border-white/12 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#ff2d78]/50"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            void handleSubmit();
          }}
          disabled={isSubmitting || !lyricsText.trim()}
          className="inline-flex w-full items-center justify-center rounded-full border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Importing lyrics..." : "Import local lyrics"}
        </button>
      </div>
    </>
  );
}
