type RomanizedReplacementRule = {
  pattern: RegExp;
  replacement: string;
  note: string;
};

const ROMANIZED_REPLACEMENT_RULES: RomanizedReplacementRule[] = [
  {
    pattern: /\b(menu|mennu|minu)\b/gi,
    replacement: "mainu",
    note: "Normalized object-pronoun spelling variants to 'mainu'."
  },
  {
    pattern: /\b(tenu|tannu)\b/gi,
    replacement: "tainu",
    note: "Normalized second-person object-pronoun spelling variants to 'tainu'."
  },
  {
    pattern: /\b(sanu)\b/gi,
    replacement: "saanu",
    note: "Normalized plural object-pronoun spelling variants to 'saanu'."
  },
  {
    pattern: /\b(onu|ohnu|uhnu)\b/gi,
    replacement: "ohnu",
    note: "Normalized third-person object-pronoun spelling variants to 'ohnu'."
  },
  {
    pattern: /\b(nae|nai|nhi|nahi)\b/gi,
    replacement: "ni",
    note: "Normalized common negative-particle spellings to 'ni'."
  },
  {
    pattern: /\b(krda)\b/gi,
    replacement: "karda",
    note: "Expanded clipped verb form 'krda' to 'karda'."
  },
  {
    pattern: /\b(krdi)\b/gi,
    replacement: "kardi",
    note: "Expanded clipped verb form 'krdi' to 'kardi'."
  },
  {
    pattern: /\b(krde)\b/gi,
    replacement: "karde",
    note: "Expanded clipped verb form 'krde' to 'karde'."
  },
  {
    pattern: /\b(krna)\b/gi,
    replacement: "karna",
    note: "Expanded clipped infinitive 'krna' to 'karna'."
  },
  {
    pattern: /\b(jivein|jiwein|jiven|jiwen)\b/gi,
    replacement: "jive",
    note: "Normalized comparison marker variants to 'jive'."
  },
  {
    pattern: /\b(vi|vee)\b/gi,
    replacement: "vi",
    note: "Normalized emphasis particle variants to 'vi'."
  },
  {
    pattern: /\b(aa|ae)\b/gi,
    replacement: "ae",
    note: "Normalized common copula spellings to 'ae'."
  }
];

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function stripDiacritics(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function normalizePunctuation(value: string) {
  return value
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\p{L}\p{N}'\s-]+/gu, " ")
    .replace(/-/g, " ");
}

export type RomanizedNormalization = {
  canonical: string;
  notes: string[];
};

export function normalizeRomanizedText(value: string) {
  let next = normalizeWhitespace(normalizePunctuation(stripDiacritics(value.toLowerCase())));
  const notes: string[] = [];

  for (const rule of ROMANIZED_REPLACEMENT_RULES) {
    const replaced = next.replace(rule.pattern, rule.replacement);

    if (replaced !== next) {
      notes.push(rule.note);
      next = replaced;
    }
  }

  next = next
    .replace(/\byaar+\b/g, "yaar")
    .replace(/\bjatt+a*\b/g, "jatt")
    .replace(/\bakk+h+\b/g, "akh")
    .replace(/\bchh+e\b/g, "chhe")
    .replace(/\b([a-z])\1{2,}\b/g, "$1$1");

  next = normalizeWhitespace(next);

  return {
    canonical: next,
    notes: Array.from(new Set(notes))
  } satisfies RomanizedNormalization;
}

export function normalizeLookupText(value: string) {
  return normalizeRomanizedText(value).canonical
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function tokenizeNormalizedRomanizedText(value: string) {
  return normalizeLookupText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}
