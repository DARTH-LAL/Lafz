export function normalizeBrainKey(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : null;
}

export function normalizeBrainText(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

export function splitArtistCredits(artist: string | null | undefined) {
  if (!artist) {
    return [] as { name: string; key: string }[];
  }

  const credits = artist
    .split(/,|&| feat\.? | ft\.? | x /i)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((name) => ({ name, key: normalizeBrainKey(name) }))
    .filter((entry): entry is { name: string; key: string } => Boolean(entry.key));

  return credits;
}

export function uniqStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

export function buildSongNodeKey(spotifyTrackId: string) {
  return spotifyTrackId.trim();
}

export function buildEntityInstanceKey(spotifyTrackId: string, entityKey: string) {
  return `${spotifyTrackId}:${entityKey.trim().toLowerCase()}`;
}

export function buildEdgeKey(edgeType: string, sourceNodeId: string, targetNodeId: string, sourceSongId?: string | null) {
  return [edgeType, sourceNodeId, targetNodeId, sourceSongId ?? "global"].join("::");
}

export function buildMemoryPackCacheKey(artistKeys: string[], spotifyTrackId: string) {
  return `translation:${[...artistKeys].sort().join(",")}:${spotifyTrackId}`;
}
