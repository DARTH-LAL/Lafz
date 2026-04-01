import { createHash } from "node:crypto";

function stripCombiningMarks(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeBrainKey(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = stripCombiningMarks(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized.length > 0 ? normalized : null;
}

export function normalizeBrainText(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = stripCombiningMarks(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

export function tokenizeBrainText(value: string | null | undefined) {
  const normalized = normalizeBrainText(value);

  if (!normalized) {
    return [] as string[];
  }

  return normalized
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function buildBrainAliases(values: Array<string | null | undefined>) {
  const aliases = new Set<string>();

  for (const value of values) {
    const trimmed = value?.trim();

    if (!trimmed) {
      continue;
    }

    aliases.add(trimmed);

    const normalizedText = normalizeBrainText(trimmed);

    if (normalizedText && normalizedText !== trimmed) {
      aliases.add(normalizedText);
    }
  }

  return Array.from(aliases);
}

type MotifTaxonomyRule = {
  canonicalKey: string;
  displayLabel: string;
  keywords: string[];
};

const MOTIF_TAXONOMY_RULES: MotifTaxonomyRule[] = [
  {
    canonicalKey: "loyalty-and-crew",
    displayLabel: "loyalty and crew",
    keywords: ["loyalty", "crew", "friends", "friendship", "yaari", "camaraderie", "brotherhood", "keeping one"]
  },
  {
    canonicalKey: "longing-and-absence",
    displayLabel: "longing and absence",
    keywords: ["longing", "absence", "distance", "overseas", "missing", "unfulfilled", "restless", "sleepless"]
  },
  {
    canonicalKey: "heartbreak-and-betrayal",
    displayLabel: "heartbreak and betrayal",
    keywords: ["heartbreak", "broken", "betrayal", "broken trust", "pain", "aftermath", "regret"]
  },
  {
    canonicalKey: "romance-and-devotion",
    displayLabel: "romance and devotion",
    keywords: ["romantic", "romance", "devotion", "love", "beloved", "togetherness", "companion", "affection"]
  },
  {
    canonicalKey: "beauty-and-attraction",
    displayLabel: "beauty and attraction",
    keywords: ["beauty", "eyes", "gaze", "admiration", "attraction", "captivation", "praise"]
  },
  {
    canonicalKey: "pride-and-identity",
    displayLabel: "pride and identity",
    keywords: ["identity", "jatt", "desi", "punjabi", "roots", "pride", "masculine", "chant"]
  },
  {
    canonicalKey: "status-and-luxury",
    displayLabel: "status and luxury",
    keywords: ["luxury", "status", "money", "cars", "rolls", "daytona", "fashion", "wealth"]
  },
  {
    canonicalKey: "rivalry-and-dominance",
    displayLabel: "rivalry and dominance",
    keywords: ["rivals", "dominance", "fearlessness", "warning", "power", "outsiders", "bravado", "taunt"]
  },
  {
    canonicalKey: "nightlife-and-partying",
    displayLabel: "nightlife and partying",
    keywords: ["nightlife", "party", "club", "drinking", "dancing", "celebration"]
  },
  {
    canonicalKey: "faith-and-destiny",
    displayLabel: "faith and destiny",
    keywords: ["faith", "god", "rabb", "divine", "destiny", "compatibility", "fate"]
  },
  {
    canonicalKey: "family-and-commitment",
    displayLabel: "family and commitment",
    keywords: ["family", "father", "marriage", "approval", "commitment", "boyfriend"]
  },
  {
    canonicalKey: "art-and-self-expression",
    displayLabel: "art and self-expression",
    keywords: ["art", "rap", "expression", "testimony", "music", "lyrics", "artist tags"]
  },
  {
    canonicalKey: "emotional-turmoil",
    displayLabel: "emotional turmoil",
    keywords: ["emotional", "vulnerability", "shaken", "denial", "suffering", "turmoil", "obsession", "dependence"]
  },
  {
    canonicalKey: "public-attention-and-hype",
    displayLabel: "public attention and hype",
    keywords: ["public attention", "hype", "global", "mobility", "spotlight"]
  }
];

export function splitArtistCredits(artist: string | null | undefined) {
  if (!artist) {
    return [] as { name: string; key: string }[];
  }

  const credits = artist
    .split(/\s*(?:,|&|\band\b|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bx\b)\s*/i)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((name) => ({ name, key: normalizeBrainKey(name) }))
    .filter((entry): entry is { name: string; key: string } => Boolean(entry.key));

  return credits;
}

export function uniqStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim().replace(/\s+/g, " "))
        .filter((value): value is string => Boolean(value))
    )
  );
}

export function buildCandidateTextSignature(candidateTexts: Array<string | null | undefined>) {
  const normalized = uniqStrings(candidateTexts.map((value) => normalizeBrainText(value))).sort();

  if (normalized.length === 0) {
    return null;
  }

  return createHash("sha1").update(normalized.join("\n")).digest("hex").slice(0, 12);
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

export function buildMemoryPackCacheKey(
  artistKeys: string[],
  spotifyTrackId: string,
  candidateTexts: Array<string | null | undefined> = []
) {
  const base = `translation:${[...artistKeys].sort().join(",")}:${spotifyTrackId}`;
  const signature = buildCandidateTextSignature(candidateTexts);
  return signature ? `${base}:ctx:${signature}` : base;
}

export function canonicalizeBrainMotif(value: string | null | undefined) {
  const normalized = normalizeBrainText(value);
  const fallbackKey = normalizeBrainKey(value ?? "");
  const fallbackLabel = value?.trim();

  if (!normalized || !fallbackKey || !fallbackLabel) {
    return null;
  }

  for (const rule of MOTIF_TAXONOMY_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return {
        canonicalKey: rule.canonicalKey,
        displayLabel: rule.displayLabel,
        sourceLabel: fallbackLabel
      };
    }
  }

  return {
    canonicalKey: fallbackKey,
    displayLabel: fallbackLabel,
    sourceLabel: fallbackLabel
  };
}
