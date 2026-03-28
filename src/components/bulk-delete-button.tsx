"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type BulkDeleteButtonProps = {
  spotifyTrackIds: string[];
  label: string;
};

export function BulkDeleteButton({ spotifyTrackIds, label }: BulkDeleteButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function handleBulkDelete() {
    setDeleting(true);
    setProgress({ done: 0, total: spotifyTrackIds.length });

    for (let i = 0; i < spotifyTrackIds.length; i++) {
      try {
        await fetch("/api/library/delete-track", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spotifyTrackId: spotifyTrackIds[i] })
        });
      } catch {
        // continue on individual failures
      }
      setProgress({ done: i + 1, total: spotifyTrackIds.length });
    }

    router.refresh();
    setDeleting(false);
    setConfirming(false);
    setProgress(null);
  }

  if (spotifyTrackIds.length === 0) return null;

  if (deleting && progress) {
    return (
      <div className="flex items-center gap-3 rounded-full border border-[rgba(255,80,80,0.2)] bg-[rgba(255,50,80,0.07)] px-4 py-2">
        <span className="text-[12px] text-[rgba(255,100,100,0.7)]">
          Deleting {progress.done}/{progress.total}…
        </span>
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
          <div
            className="h-full rounded-full bg-[#ff4d64] transition-all duration-300"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-3 rounded-full border border-[rgba(255,80,80,0.25)] bg-[rgba(255,50,80,0.08)] px-4 py-2">
        <span className="text-[12px] text-[rgba(255,180,180,0.8)]">
          Delete all {spotifyTrackIds.length} tracks?
        </span>
        <button
          onClick={handleBulkDelete}
          className="rounded-full bg-[rgba(255,50,80,0.85)] px-3 py-1 text-[11px] font-bold text-white transition hover:bg-[rgba(255,50,80,1)]"
        >
          Yes, delete all
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="rounded-full border border-[rgba(255,255,255,0.10)] px-3 py-1 text-[11px] font-semibold text-[rgba(255,255,255,0.4)] transition hover:text-white"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,80,80,0.18)] bg-[rgba(255,50,80,0.07)] px-4 py-2 text-[12px] font-semibold text-[rgba(255,100,100,0.65)] transition hover:border-[rgba(255,50,80,0.4)] hover:bg-[rgba(255,50,80,0.15)] hover:text-[#ff8080]"
    >
      <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
        <path fillRule="evenodd" d="M8.5 1.75A.75.75 0 0 1 9.25 1h1.5a.75.75 0 0 1 .75.75V3h3.25a.75.75 0 0 1 0 1.5H5.25a.75.75 0 0 1 0-1.5H8.5V1.75ZM6.05 6.5a.75.75 0 0 1 .75.695l.6 8.055H12.6l.6-8.055a.75.75 0 1 1 1.497.112l-.6 8.055A1.75 1.75 0 0 1 12.35 17H7.65a1.75 1.75 0 0 1-1.747-1.638l-.6-8.055A.75.75 0 0 1 6.05 6.5Z" clipRule="evenodd" />
      </svg>
      {label} ({spotifyTrackIds.length})
    </button>
  );
}
