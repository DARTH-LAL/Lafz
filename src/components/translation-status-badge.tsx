import type { DerivedQueueStatus } from "@/features/library/types";
import { cx } from "@/lib/utils";

const statusLabelMap: Record<DerivedQueueStatus, string> = {
  pending: "Pending",
  stub: "Stub",
  translated: "Translated"
};

const statusClassMap: Record<DerivedQueueStatus, string> = {
  pending: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  stub: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
  translated: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
};

type TranslationStatusBadgeProps = {
  status: DerivedQueueStatus;
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
