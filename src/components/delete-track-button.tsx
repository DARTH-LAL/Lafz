"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type DeleteTrackButtonProps = {
  spotifyTrackId: string;
  trackTitle: string;
};

export function DeleteTrackButton({ spotifyTrackId, trackTitle }: DeleteTrackButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await fetch("/api/library/delete-track", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spotifyTrackId })
      });
      router.refresh();
    } catch {
      setDeleting(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[rgba(255,255,255,0.4)]">Delete?</span>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="inline-flex items-center justify-center rounded-full bg-[rgba(255,50,80,0.85)] px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-[rgba(255,50,80,1)] disabled:opacity-50"
        >
          {deleting ? "…" : "Yes"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={deleting}
          className="inline-flex items-center justify-center rounded-full border border-[rgba(255,255,255,0.10)] px-3 py-1.5 text-[11px] font-semibold text-[rgba(255,255,255,0.4)] transition hover:text-white disabled:opacity-50"
        >
          No
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      title={`Delete ${trackTitle}`}
      className="inline-flex items-center justify-center rounded-full border border-[rgba(255,80,80,0.18)] bg-[rgba(255,50,80,0.07)] p-2 text-[rgba(255,100,100,0.5)] transition hover:border-[rgba(255,50,80,0.4)] hover:bg-[rgba(255,50,80,0.18)] hover:text-[#ff6464]"
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden="true">
        <path fillRule="evenodd" d="M8.5 1.75A.75.75 0 0 1 9.25 1h1.5a.75.75 0 0 1 .75.75V3h3.25a.75.75 0 0 1 0 1.5H5.25a.75.75 0 0 1 0-1.5H8.5V1.75ZM6.05 6.5a.75.75 0 0 1 .75.695l.6 8.055H12.6l.6-8.055a.75.75 0 1 1 1.497.112l-.6 8.055A1.75 1.75 0 0 1 12.35 17H7.65a1.75 1.75 0 0 1-1.747-1.638l-.6-8.055A.75.75 0 0 1 6.05 6.5Z" clipRule="evenodd"/>
      </svg>
    </button>
  );
}
