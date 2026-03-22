"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { formatMilliseconds } from "@/lib/utils";

type ProgressBarProps = {
  currentMs: number;
  totalMs: number;
  onSeek?: (positionMs: number) => Promise<void> | void;
};

export function ProgressBar({ currentMs, totalMs, onSeek }: ProgressBarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragPercent, setDragPercent] = useState<number | null>(null);

  const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

  const getPercentFromClientX = (clientX: number) => {
    if (!trackRef.current || totalMs <= 0) {
      return 0;
    }

    const rect = trackRef.current.getBoundingClientRect();
    const next = ((clientX - rect.left) / rect.width) * 100;
    return clampPercent(next);
  };

  const commitSeek = (percent: number) => {
    if (!onSeek || totalMs <= 0) {
      return;
    }

    void onSeek(Math.round((clampPercent(percent) / 100) * totalMs));
  };

  useEffect(() => {
    if (dragPercent === null) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      setDragPercent(getPercentFromClientX(event.clientX));
    };

    const handlePointerUp = (event: PointerEvent) => {
      const nextPercent = getPercentFromClientX(event.clientX);
      setDragPercent(null);
      commitSeek(nextPercent);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragPercent, totalMs]);

  const width = useMemo(() => {
    if (dragPercent !== null) {
      return dragPercent;
    }

    return totalMs > 0 ? clampPercent((currentMs / totalMs) * 100) : 0;
  }, [currentMs, dragPercent, totalMs]);

  const displayCurrentMs = dragPercent !== null && totalMs > 0 ? Math.round((dragPercent / 100) * totalMs) : currentMs;

  return (
    <div>
      <div
        ref={trackRef}
        className="group relative h-1 w-full cursor-pointer overflow-visible rounded-full bg-white/8 touch-none"
        onPointerDown={(event) => {
          if (totalMs <= 0) {
            return;
          }

          setDragPercent(getPercentFromClientX(event.clientX));
        }}
        role={onSeek ? "slider" : undefined}
        aria-valuemin={0}
        aria-valuemax={totalMs || 0}
        aria-valuenow={displayCurrentMs}
        aria-label={onSeek ? "Seek playback position" : undefined}
      >
        <div
          className="relative h-full rounded-full bg-[linear-gradient(135deg,#ff2d78_0%,#ff6ba8_48%,#ff8c42_100%)] transition-[width] duration-300 ease-out"
          style={{ width: `${width}%` }}
        >
          <span className="absolute right-[-6px] top-1/2 h-[13px] w-[13px] -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_2.5px_#ff2d78,0_2px_10px_rgba(255,45,120,0.5)] transition-transform duration-150 group-active:scale-110" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] font-medium tracking-[0.02em] text-[#8570a0]">
        <span>{formatMilliseconds(displayCurrentMs)}</span>
        <span>{formatMilliseconds(totalMs)}</span>
      </div>
    </div>
  );
}
