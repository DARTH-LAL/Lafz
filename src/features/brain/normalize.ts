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

export type BrainEntityClass =
  | "actor"
  | "group"
  | "embodied_symbol"
  | "status_object"
  | "place"
  | "body_part"
  | "material_object"
  | "symbolic"
  | "abstract"
  | "other";

type RelationshipFamily = {
  canonicalKey: string;
  displayLabel: string;
};

const ACTOR_ENTITY_KEYS = new Set([
  "narrator",
  "speaker",
  "self",
  "lover",
  "beloved",
  "girl",
  "boy",
  "woman",
  "man",
  "mother",
  "father",
  "family",
  "friend",
  "friends",
  "rival",
  "rivals",
  "hater",
  "haters",
  "people",
  "god",
  "rabb"
]);

const GROUP_ENTITY_KEYS = new Set([
  "crew",
  "gang",
  "team",
  "circle",
  "friends",
  "family",
  "rivals",
  "haters",
  "people",
  "audience"
]);

const EMBODIED_SYMBOL_ENTITY_KEYS = new Set([
  "heart",
  "dil",
  "soul",
  "mind",
  "eyes",
  "gaze",
  "glance",
  "breath",
  "voice"
]);

const STATUS_OBJECT_ENTITY_KEYS = new Set([
  "status",
  "money",
  "cash",
  "car",
  "cars",
  "chain",
  "jewelry",
  "hood",
  "land",
  "weapon",
  "weapons",
  "gun",
  "glock",
  "barood",
  "name",
  "reputation"
]);

const PLACE_ENTITY_KEYS = new Set([
  "city",
  "town",
  "village",
  "pind",
  "street",
  "streets",
  "road",
  "lane",
  "club",
  "home",
  "house",
  "shore",
  "river",
  "sea",
  "ocean"
]);

const BODY_PART_ENTITY_KEYS = new Set([
  "arm",
  "arms",
  "hand",
  "hands",
  "lips",
  "face",
  "chehra",
  "hair",
  "zulf",
  "zulfa",
  "head",
  "skin"
]);

const MATERIAL_OBJECT_ENTITY_KEYS = new Set([
  "pearl",
  "pearls",
  "flower",
  "flowers",
  "rose",
  "roses",
  "mirror",
  "bottle",
  "veil"
]);

const ABSTRACT_ENTITY_KEYS = new Set([
  "love",
  "ishq",
  "truth",
  "honesty",
  "art",
  "music",
  "rap",
  "beauty",
  "fate",
  "destiny"
]);

const SYMBOLIC_ENTITY_KEYS = new Set([
  "weather",
  "season",
  "night",
  "mask",
  "concealment",
  "shadow",
  "signal",
  "omen"
]);

const RELATIONSHIP_FAMILY_RULES: Array<RelationshipFamily & { keywords: string[] }> = [
  {
    canonicalKey: "warning-and-dominance",
    displayLabel: "warning and dominance",
    keywords: ["warning", "threat", "taunt", "dominance", "control", "enemy", "rival", "pressure", "fear"]
  },
  {
    canonicalKey: "loyalty-and-backing",
    displayLabel: "loyalty and backing",
    keywords: ["loyalty", "support", "backing", "solidarity", "ride", "with", "trust", "protection"]
  },
  {
    canonicalKey: "devotion-and-longing",
    displayLabel: "devotion and longing",
    keywords: ["devotion", "longing", "yearning", "missing", "desire", "obsession", "urge", "pull", "call"]
  },
  {
    canonicalKey: "healing-and-reassurance",
    displayLabel: "healing and reassurance",
    keywords: ["heal", "comfort", "confirm", "reassure", "safe", "steady", "response"]
  },
  {
    canonicalKey: "teasing-and-attraction",
    displayLabel: "teasing and attraction",
    keywords: ["teasing", "flirt", "playful", "charm", "attraction", "captivation", "admiration"]
  },
  {
    canonicalKey: "status-and-display",
    displayLabel: "status and display",
    keywords: ["status", "display", "public", "reputation", "hype", "image", "spectacle"]
  },
  {
    canonicalKey: "symbolic-cue",
    displayLabel: "symbolic cue",
    keywords: ["sign", "cue", "signal", "omen", "weather", "fate"]
  }
];

type MotifTaxonomyRule = {
  canonicalKey: string;
  displayLabel: string;
  keywords: string[];
};

type PersonaStyleTaxonomyRule = {
  canonicalKey: string;
  displayLabel: string;
  keywords: string[];
};

const GENERIC_SINGLE_TOKEN_PERSONA_KEYS = new Set([
  "aggressive",
  "boastful",
  "threatening",
  "confrontational",
  "romantic",
  "emotional",
  "confident",
  "intense",
  "proud",
  "celebratory"
]);

const PERSONA_DIRECTIVE_PATTERNS = [
  /\bkeep the english\b/,
  /\bkeep english\b/,
  /\btranslate\b/,
  /\btranslation\b/,
  /\brender(?:ing)?\b/,
  /\bpreserve\b/,
  /\bmake the english\b/,
  /\bslang-aware\b/,
  /\brhythm-friendly\b/,
  /\bwhen named\b/,
  /\bwordplay\b/,
  /\bstatus symbols?\b/,
  /\bexplicitly\b/
];

const PERSONA_SENTENCE_CUE_PATTERNS = [
  /^(?:often|usually|frequently|typically)\b/,
  /^(?:uses|use|leans|frames|contrasts|keeps|sounds|delivers)\b/,
  /\bstrong masculine posture\b/,
  /\bproof of toughness\b/,
  /\bproof of status\b/,
  /\breal ones\b/,
  /\bfakes?\b/,
  /\boutsiders\b/,
  /\bself[- ]defining\b/
];

const MOTIF_TAXONOMY_RULES: MotifTaxonomyRule[] = [
  {
    canonicalKey: "loyalty-and-crew",
    displayLabel: "loyalty and crew",
    keywords: [
      "loyalty",
      "crew",
      "friends",
      "friendship",
      "yaari",
      "camaraderie",
      "brotherhood",
      "keeping one",
      "tooli",
      "squad",
      "backing"
    ]
  },
  {
    canonicalKey: "longing-and-absence",
    displayLabel: "longing and absence",
    keywords: [
      "longing",
      "absence",
      "distance",
      "overseas",
      "missing",
      "unfulfilled",
      "restless",
      "sleepless",
      "yearning"
    ]
  },
  {
    canonicalKey: "heartbreak-and-betrayal",
    displayLabel: "heartbreak and betrayal",
    keywords: [
      "heartbreak",
      "broken",
      "betrayal",
      "broken trust",
      "pain",
      "aftermath",
      "regret",
      "snake",
      "snake-like",
      "shady scheme",
      "shady schemes",
      "schemes",
      "shady behavior",
      "distrust",
      "deception",
      "two-faced"
    ]
  },
  {
    canonicalKey: "romance-and-devotion",
    displayLabel: "romance and devotion",
    keywords: [
      "romantic",
      "romance",
      "devotion",
      "love",
      "beloved",
      "togetherness",
      "companion",
      "affection",
      "hand-holding",
      "hand holding",
      "meeting face to face",
      "face to face",
      "close together",
      "future together"
    ]
  },
  {
    canonicalKey: "beauty-and-attraction",
    displayLabel: "beauty and attraction",
    keywords: ["beauty", "eyes", "gaze", "admiration", "attraction", "captivation", "praise", "kajal", "hair let down"]
  },
  {
    canonicalKey: "pride-and-identity",
    displayLabel: "pride and identity",
    keywords: ["identity", "jatt", "desi", "punjabi", "roots", "pride", "masculine", "chant", "discipline", "fitness"]
  },
  {
    canonicalKey: "status-and-luxury",
    displayLabel: "status and luxury",
    keywords: ["luxury", "status", "money", "cars", "rolls", "daytona", "fashion", "wealth", "showing off"]
  },
  {
    canonicalKey: "rivalry-and-dominance",
    displayLabel: "rivalry and dominance",
    keywords: [
      "rivals",
      "dominance",
      "fearlessness",
      "warning",
      "power",
      "outsiders",
      "bravado",
      "taunt",
      "keeping score",
      "score",
      "accounts",
      "books",
      "battle",
      "readiness",
      "targets",
      "target",
      "shooting",
      "beatings",
      "menace",
      "retaliation",
      "intimidation",
      "pressure",
      "weapon",
      "weapons",
      "violence",
      "weapons and violence"
    ]
  },
  {
    canonicalKey: "legal-trouble-and-surveillance",
    displayLabel: "legal trouble and surveillance",
    keywords: [
      "police",
      "station",
      "prison",
      "jail",
      "court",
      "case files",
      "casefile",
      "law enforcement",
      "surveillance",
      "raids",
      "custody"
    ]
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
    keywords: ["family", "father", "marriage", "approval", "commitment", "boyfriend", "future together", "settling down"]
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
    keywords: [
      "public attention",
      "hype",
      "global",
      "mobility",
      "spotlight",
      "city-wide",
      "city wide",
      "whole city",
      "the whole city",
      "public notice",
      "gossip",
      "buzz",
      "talking",
      "public judgment",
      "judgment dismissed"
    ]
  }
];

const PERSONA_STYLE_TAXONOMY_RULES: PersonaStyleTaxonomyRule[] = [
  {
    canonicalKey: "dominant-flex-and-intimidation",
    displayLabel: "dominant flex and intimidation",
    keywords: [
      "dominant",
      "flex",
      "swagger",
      "intimidat",
      "fearless",
      "menace",
      "boss",
      "commanding",
      "taunt",
      "bravado",
      "proof of toughness",
      "proof of status",
      "personal proof",
      "punchy lines",
      "strong masculine posture",
      "masculine posture",
      "toughness or status"
    ]
  },
  {
    canonicalKey: "teasing-romantic-charm",
    displayLabel: "teasing romantic charm",
    keywords: ["teasing", "playful", "flirt", "charm", "romantic tease", "coy", "captivat", "smirk"]
  },
  {
    canonicalKey: "wounded-longing-and-vulnerability",
    displayLabel: "wounded longing and vulnerability",
    keywords: ["longing", "yearning", "vulnerab", "aching", "missing", "restless", "heartbroken", "obsess", "dependent", "emotional turmoil"]
  },
  {
    canonicalKey: "devotional-romantic-yearning",
    displayLabel: "devotional romantic yearning",
    keywords: ["devotional", "devotion", "beloved", "reassur", "heal", "surrender", "adore", "romance and devotion"]
  },
  {
    canonicalKey: "street-loyalty-and-authority",
    displayLabel: "street loyalty and authority",
    keywords: [
      "street",
      "loyal",
      "crew",
      "authority",
      "command",
      "brotherhood",
      "backing",
      "ride or die",
      "hood",
      "real ones",
      "fake ones",
      "fakes or outsiders",
      "fakes",
      "outsiders"
    ]
  },
  {
    canonicalKey: "spiritual-reflective-introspection",
    displayLabel: "spiritual reflective introspection",
    keywords: ["spiritual", "reflective", "introspect", "destiny", "fate", "rabb", "god", "soul", "inner", "meditat"]
  },
  {
    canonicalKey: "rebellious-pride-and-defiance",
    displayLabel: "rebellious pride and defiance",
    keywords: [
      "defian",
      "pride",
      "self-respect",
      "self respect",
      "rebell",
      "unapologetic",
      "independent",
      "stubborn",
      "self-defining",
      "self defining",
      "first-person and self-defining",
      "first person and self defining"
    ]
  },
  {
    canonicalKey: "gentle-reassurance-and-healing",
    displayLabel: "gentle reassurance and healing",
    keywords: ["gentle", "reassur", "healing", "comfort", "soft", "steady", "safe", "calm"]
  }
];

const CANONICAL_MOTIF_KEYS = new Set(MOTIF_TAXONOMY_RULES.map((rule) => rule.canonicalKey));

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

export function classifyBrainEntity(
  entityKey: string | null | undefined,
  label?: string | null | undefined,
  description?: string | null | undefined
): BrainEntityClass {
  const normalizedKey = normalizeBrainKey(entityKey);

  if (normalizedKey) {
    if (ACTOR_ENTITY_KEYS.has(normalizedKey)) {
      return GROUP_ENTITY_KEYS.has(normalizedKey) ? "group" : "actor";
    }

    if (GROUP_ENTITY_KEYS.has(normalizedKey)) {
      return "group";
    }

    if (EMBODIED_SYMBOL_ENTITY_KEYS.has(normalizedKey)) {
      return "embodied_symbol";
    }

    if (STATUS_OBJECT_ENTITY_KEYS.has(normalizedKey)) {
      return "status_object";
    }

    if (PLACE_ENTITY_KEYS.has(normalizedKey)) {
      return "place";
    }

    if (BODY_PART_ENTITY_KEYS.has(normalizedKey)) {
      return "body_part";
    }

    if (MATERIAL_OBJECT_ENTITY_KEYS.has(normalizedKey)) {
      return "material_object";
    }

    if (ABSTRACT_ENTITY_KEYS.has(normalizedKey)) {
      return "abstract";
    }

    if (SYMBOLIC_ENTITY_KEYS.has(normalizedKey)) {
      return "symbolic";
    }
  }

  const normalizedText = normalizeBrainText([label, description].filter(Boolean).join(" "));

  if (!normalizedText) {
    return "other";
  }

  if (/\b(crew|friends|circle|family|rivals|haters|people|audience)\b/.test(normalizedText)) {
    return "group";
  }

  if (/\b(narrator|speaker|lover|beloved|girl|boy|woman|man|mother|father|god|rabb)\b/.test(normalizedText)) {
    return "actor";
  }

  if (/\b(heart|soul|mind|eyes|gaze|glance|voice|breath)\b/.test(normalizedText)) {
    return "embodied_symbol";
  }

  if (/\b(status|money|cash|car|cars|chain|jewelry|hood|land|weapon|weapons|gun|glock|name|reputation)\b/.test(normalizedText)) {
    return "status_object";
  }

  if (/\b(city|town|village|pind|street|streets|road|lane|club|home|house|shore|river|sea|ocean)\b/.test(normalizedText)) {
    return "place";
  }

  if (/\b(arm|arms|hand|hands|lips|face|chehra|hair|zulf|zulfa|head|skin)\b/.test(normalizedText)) {
    return "body_part";
  }

  if (/\b(pearl|pearls|flower|flowers|rose|roses|mirror|bottle|veil)\b/.test(normalizedText)) {
    return "material_object";
  }

  if (/\b(weather|season|night|mask|concealment|shadow|signal|omen)\b/.test(normalizedText)) {
    return "symbolic";
  }

  if (/\b(love|ishq|truth|honesty|art|music|rap|beauty|fate|destiny)\b/.test(normalizedText)) {
    return "abstract";
  }

  return "other";
}

export function isReusableArtistEntityClass(entityClass: string | null | undefined) {
  return (
    entityClass === "actor" ||
    entityClass === "group" ||
    entityClass === "embodied_symbol" ||
    entityClass === "status_object"
  );
}

export function canonicalizeRelationshipDynamic(
  dynamic: string | null | undefined,
  sourceEntityKey?: string | null | undefined,
  targetEntityKey?: string | null | undefined
) {
  const normalized = normalizeBrainText(dynamic);
  const fallbackKey = normalizeBrainKey(dynamic ?? "");
  const fallbackLabel = dynamic?.trim();

  if (!normalized || !fallbackKey || !fallbackLabel) {
    return null;
  }

  const combined = [normalized, normalizeBrainText(sourceEntityKey), normalizeBrainText(targetEntityKey)]
    .filter(Boolean)
    .join(" ");

  for (const rule of RELATIONSHIP_FAMILY_RULES) {
    if (rule.keywords.some((keyword) => combined.includes(keyword))) {
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

export function isGenericSingleTokenPersonaStyle(value: string | null | undefined) {
  const normalized = normalizeBrainKey(value);
  const tokens = tokenizeBrainText(value);

  return Boolean(normalized && tokens.length === 1 && GENERIC_SINGLE_TOKEN_PERSONA_KEYS.has(normalized));
}

export function isDirectiveLikePersonaStyleText(value: string | null | undefined) {
  const normalized = normalizeBrainText(value);

  if (!normalized) {
    return false;
  }

  return PERSONA_DIRECTIVE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isSentenceLikePersonaStyleText(value: string | null | undefined) {
  const normalized = normalizeBrainText(value);

  if (!normalized) {
    return false;
  }

  const tokens = tokenizeBrainText(normalized);

  return (
    /[.!?]/.test(value ?? "") ||
    tokens.length >= 6 ||
    PERSONA_SENTENCE_CUE_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

export function canonicalizePersonaStyle(value: string | null | undefined) {
  const normalized = normalizeBrainText(value);
  const fallbackKey = normalizeBrainKey(value ?? "");
  const fallbackLabel = value?.trim();

  if (!normalized || !fallbackKey || !fallbackLabel) {
    return null;
  }

  if (isDirectiveLikePersonaStyleText(value) || isGenericSingleTokenPersonaStyle(value)) {
    return null;
  }

  for (const rule of PERSONA_STYLE_TAXONOMY_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return {
        canonicalKey: rule.canonicalKey,
        displayLabel: rule.displayLabel,
        sourceLabel: fallbackLabel
      };
    }
  }

  if (isSentenceLikePersonaStyleText(value)) {
    return null;
  }

  return {
    canonicalKey: fallbackKey,
    displayLabel: fallbackLabel,
    sourceLabel: fallbackLabel
  };
}

export function isCanonicalBrainMotifKey(value: string | null | undefined) {
  return Boolean(value && CANONICAL_MOTIF_KEYS.has(value.trim()));
}

export function isCanonicalBrainMotifNode(
  displayLabel: string | null | undefined,
  canonicalKey: string | null | undefined
) {
  const trimmedLabel = displayLabel?.trim() ?? null;
  const trimmedKey = canonicalKey?.trim() ?? null;

  if (!trimmedLabel || !trimmedKey) {
    return false;
  }

  const canonicalMotif = canonicalizeBrainMotif(trimmedLabel);

  return Boolean(
    canonicalMotif &&
      canonicalMotif.canonicalKey === trimmedKey &&
      canonicalMotif.displayLabel === trimmedLabel &&
      isCanonicalBrainMotifKey(trimmedKey)
  );
}
