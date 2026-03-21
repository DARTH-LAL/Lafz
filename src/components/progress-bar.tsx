import { formatMilliseconds } from "@/lib/utils";

type ProgressBarProps = {
  currentMs: number;
  totalMs: number;
};

export function ProgressBar({ currentMs, totalMs }: ProgressBarProps) {
  const width = totalMs > 0 ? Math.min(100, Math.max(0, (currentMs / totalMs) * 100)) : 0;

  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-cyan-400 to-amber-300 transition-[width] duration-300 ease-out"
          style={{ width: `${width}%` }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between text-sm text-slate-400">
        <span>{formatMilliseconds(currentMs)}</span>
        <span>{formatMilliseconds(totalMs)}</span>
      </div>
    </div>
  );
}
