import type { LyricsCue } from "@/features/lyrics/types";

const lrcLinePattern = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const lrcDetectionPattern = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/;

function fractionToMilliseconds(fraction: string | undefined) {
  if (!fraction) {
    return 0;
  }

  if (fraction.length === 3) {
    return Number.parseInt(fraction, 10);
  }

  if (fraction.length === 2) {
    return Number.parseInt(fraction, 10) * 10;
  }

  return Number.parseInt(fraction, 10) * 100;
}

export function parseLrcText(text: string): LyricsCue[] {
  const cues: LyricsCue[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const timestamps = [...rawLine.matchAll(lrcLinePattern)];

    if (timestamps.length === 0) {
      continue;
    }

    const lyricText = rawLine.replace(lrcLinePattern, "").trim();

    if (!lyricText) {
      continue;
    }

    for (const timestamp of timestamps) {
      const minutes = Number.parseInt(timestamp[1] ?? "0", 10);
      const seconds = Number.parseInt(timestamp[2] ?? "0", 10);
      const milliseconds = fractionToMilliseconds(timestamp[3]);

      if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || !Number.isFinite(milliseconds)) {
        continue;
      }

      cues.push({
        startMs: minutes * 60_000 + seconds * 1_000 + milliseconds,
        text: lyricText
      });
    }
  }

  return cues.sort((left, right) => left.startMs - right.startMs);
}

export function isLikelyLrcText(text: string) {
  return lrcDetectionPattern.test(text);
}

export function formatCueTimestamp(startMs: number) {
  const safeMs = Math.max(0, Math.floor(startMs));
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.floor((safeMs % 60_000) / 1_000);
  const centiseconds = Math.floor((safeMs % 1_000) / 10);

  return `[${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${centiseconds
    .toString()
    .padStart(2, "0")}]`;
}
