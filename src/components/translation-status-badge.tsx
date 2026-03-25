import type { StudioQueueStatus } from "@/features/library/types";
import { cx } from "@/lib/utils";

const statusLabelMap: Record<StudioQueueStatus, string> = {
  needs_lyrics: "Needs lyrics",
  lyrics_ready: "Lyrics ready",
  needs_review: "Needs review",
  reviewed: "Reviewed",
  synced: "Synced",
  published: "Published"
};

const statusClassMap: Record<StudioQueueStatus, string> = {
  needs_lyrics: "border-[rgba(255,45,120,0.24)] bg-[rgba(255,45,120,0.09)] text-[#ffd2e4]",
  lyrics_ready: "border-fuchsia-300/20 bg-fuchsia-300/10 text-fuchsia-100",
  needs_review: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  reviewed: "border-sky-300/20 bg-sky-300/10 text-sky-100",
  synced: "border-[rgba(255,140,66,0.24)] bg-[rgba(255,140,66,0.1)] text-[#ffd9b8]",
  published: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
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
