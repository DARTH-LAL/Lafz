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
          className={`mt-4 rounded-[14px] p-4 text-[13px] leading-[1.65] ${
            messageTone === "error"
              ? "border border-[rgba(255,160,30,0.20)] bg-[rgba(255,160,30,0.08)] text-[#ffc87a]"
              : "border border-[rgba(255,20,100,0.20)] bg-[rgba(255,20,100,0.08)] text-[#ff6aaa]"
          }`}
        >
          {message}
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-2 block text-[12px] font-bold uppercase tracking-[1px] text-[rgba(255,20,100,0.70)]">Lyrics text</span>
          <textarea
            value={lyricsText}
            onChange={(event) => { setLyricsText(event.target.value); }}
            rows={8}
            placeholder={`[00:12.34] Example timed line\n[00:16.40] Another line\n\nor plain lyrics text\n\nor synced JSON`}
            className="w-full rounded-[14px] border border-[rgba(255,20,100,0.16)] bg-[rgba(255,20,100,0.05)] px-4 py-3 font-mono text-[13px] text-white outline-none transition placeholder:text-white focus:border-[rgba(255,20,100,0.50)] focus:shadow-[0_0_0_3px_rgba(255,20,100,0.10)]"
          />
        </label>
        <button
          type="button"
          onClick={() => { void handleSubmit(); }}
          disabled={isSubmitting || !lyricsText.trim()}
          className="w-full rounded-full bg-[linear-gradient(135deg,#ff1464,#ff6aaa)] py-3 text-[14px] font-bold text-white shadow-[0_0_20px_rgba(255,20,100,0.35)] transition hover:opacity-90 hover:shadow-[0_0_32px_rgba(255,20,100,0.55)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? "Importing lyrics..." : "Save Lyrics"}
        </button>
      </div>
    </>
  );
}
