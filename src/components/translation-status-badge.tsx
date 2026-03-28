import type { StudioQueueStatus } from "@/features/library/types";
import { cx } from "@/lib/utils";

const statusLabelMap: Record<StudioQueueStatus, string> = {
  needs_lyrics: "Needs lyrics",
  lyrics_ready: "Lyrics ready",
  needs_review: "Needs review",
  unsynced: "Unsynced",
  synced: "Synced"
};

const statusClassMap: Record<StudioQueueStatus, string> = {
  needs_lyrics: "border-[rgba(255,70,70,0.32)] bg-[rgba(255,70,70,0.10)] text-[#ff9999]",
  lyrics_ready: "border-[rgba(64,232,255,0.28)] bg-[rgba(64,232,255,0.10)] text-[#40e8ff]",
  needs_review: "border-[rgba(255,179,71,0.32)] bg-[rgba(255,179,71,0.10)] text-[#ffcc88]",
  unsynced: "border-[rgba(162,89,255,0.32)] bg-[rgba(162,89,255,0.10)] text-[#c87eff]",
  synced: "border-[rgba(63,255,170,0.32)] bg-[rgba(63,255,170,0.10)] text-[#3fffaa]"
};

type TranslationStatusBadgeProps = {
  status: StudioQueueStatus;
};

export function TranslationStatusBadge({ status }: TranslationStatusBadgeProps) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em]",
        statusClassMap[status]
      )}
    >
      {statusLabelMap[status]}
    </span>
  );
}
