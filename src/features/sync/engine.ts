import type { TranslationLine } from "@/features/translations/types";

export function findActiveLineIndex(lines: TranslationLine[], progressMs: number) {
  let low = 0;
  let high = lines.length - 1;

  // Use a binary search so active-line lookups stay cheap even if a song has a lot of timestamped lines.
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const line = lines[middle];

    if (progressMs < line.startMs) {
      high = middle - 1;
      continue;
    }

    if (progressMs > line.endMs) {
      low = middle + 1;
      continue;
    }

    return middle;
  }

  return -1;
}
