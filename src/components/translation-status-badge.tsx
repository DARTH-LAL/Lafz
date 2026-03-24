import type { DerivedQueueStatus } from "@/features/library/types";
import { cx } from "@/lib/utils";

const statusLabelMap: Record<DerivedQueueStatus, string> = {
  pending: "Pending",
  stub: "Needs lyrics",
  translated: "Translated"
};

const statusClassMap: Record<DerivedQueueStatus, string> = {
  pending: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  stub: "border-[rgba(255,45,120,0.24)] bg-[rgba(255,45,120,0.09)] text-[#ffd2e4]",
  translated: "border-[rgba(255,140,66,0.24)] bg-[rgba(255,140,66,0.1)] text-[#ffd9b8]"
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
