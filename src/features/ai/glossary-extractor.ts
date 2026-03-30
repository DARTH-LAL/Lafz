import type { AiGlossaryEntry } from "@/features/ai/glossary";
import { bulkAddGlossaryTerms, incrementGlossaryTermUseCounts, normalizeArtistKey, readArtistGlossaryFile, readPendingSuggestions } from "@/features/ai/glossary-repository";
import { getOpenAiBaseUrl, isOpenAiConfigured, resolveOpenAiModel } from "@/features/ai/openai";

// ── Types ─────────────────────────────────────────────────────────────────

type ExtractorLine = {
  original: string;
  chosen: string;
  meaning?: string | null;
};

type ExtractorOptions = {
  spotifyTrackId: string;
  title: string;
  artist: string;
  sourceLanguage: string | null;
  lines: ExtractorLine[];
  existingGlossary: AiGlossaryEntry[];
  /** Terms already queued as pending suggestions — skip these too */
  pendingSuggestionTerms?: string[];
};

type RawSuggestion = {
  term: string;
  meaning: string;
  category: string;
  reason: string;
};

// ── Schema ─────────────────────────────────────────────────────────────────

function buildExtractionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      terms: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            term:     { type: "string" },
            meaning:  { type: "string" },
            category: { type: "string", enum: ["preferred_rendering", "slang", "idiom", "phrase", "reference", "entry"] },
            reason:   { type: "string" }
          },
          required: ["term", "meaning", "category", "reason"]
        }
      }
    },
    required: ["terms"]
  };
}

// ── Prompts ────────────────────────────────────────────────────────────────

function buildSystemPrompt(options: ExtractorOptions): string {
  const language = options.sourceLanguage ?? "an unknown language";
  const acceptedTerms = options.existingGlossary.map((e) => e.term).join(", ") || "none";
  const pendingTerms = (options.pendingSuggestionTerms ?? []).join(", ") || "none";
  return [
    `You are a precision vocabulary extractor for Lafz, a personal lyric translation tool.`,
    `You are analyzing lyrics by ${options.artist} translated from ${language} to English.`,
    `Your task: identify ONLY terms that are SPECIFIC to ${options.artist}'s distinct voice or artistic style — words/phrases that a skilled translator would NOT automatically know, but that are essential for accurate, consistent translations of this artist specifically.`,
    `ACCEPT a term only if ALL of these are true:`,
    `(1) It carries a meaning specific to how ${options.artist} uses it — NOT a meaning shared by all ${language} speakers or any generic cultural reference.`,
    `(2) Missing or mistranslating it would cause a meaningfully wrong, flat, or tone-breaking translation.`,
    `(3) It is likely to recur across multiple songs by this artist.`,
    `(4) It is a short canonical form — one word or a tight 2–5 word phrase, NOT a long sentence or a slash-separated list of variants.`,
    `SKIP these categories entirely:`,
    `- Common cultural terms any ${language} translator would know (e.g. mehndi, chunni, jatt — unless used in a unique twist).`,
    `- Generic idioms or phrases not distinctive to this artist.`,
    `- Terms that are just one-off poetic images unlikely to recur.`,
    `- Long quoted lines or full sentences.`,
    `- Any variant or near-duplicate of a term already in either skip list below.`,
    `Already accepted into glossary (skip): ${acceptedTerms}.`,
    `Already queued as suggestions (skip): ${pendingTerms}.`,
    `Return at most 5 terms. If fewer than 2 strong candidates exist, return an empty array.`,
    `For each term, use its shortest canonical form, provide its preferred English meaning, category (preferred_rendering | slang | idiom | phrase | reference | entry), and a one-sentence reason explaining why it is artist-specific and translation-critical.`
  ].join(" ");
}

function buildUserPrompt(options: ExtractorOptions): string {
  const lineBlock = options.lines
    .map((l, i) => {
      const parts = [`${i + 1}. original: ${l.original}`, `chosen: ${l.chosen}`];
      if (l.meaning) parts.push(`meaning: ${l.meaning}`);
      return parts.join(" | ");
    })
    .join("\n");

  return `Song: "${options.title}" by ${options.artist}\n\nLyric lines (original → chosen translation):\n${lineBlock}\n\nExtract glossary terms worth storing for this artist.`;
}

// ── Raw API call ───────────────────────────────────────────────────────────

async function callExtraction(options: ExtractorOptions): Promise<RawSuggestion[]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured.");

  const model = await resolveOpenAiModel();
  const response = await fetch(`${getOpenAiBaseUrl()}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: buildSystemPrompt(options) },
        { role: "user", content: buildUserPrompt(options) }
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "lafz_glossary_extraction", strict: true, schema: buildExtractionSchema() }
      }
    })
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Glossary extraction failed (${response.status}): ${text.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from glossary extraction.");

  const parsed = JSON.parse(content) as { terms?: unknown[] };
  if (!Array.isArray(parsed.terms)) return [];

  return parsed.terms
    .filter(
      (t): t is RawSuggestion =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as RawSuggestion).term === "string" &&
        typeof (t as RawSuggestion).meaning === "string"
    )
    .slice(0, 5);
}

// ── Public entry point ─────────────────────────────────────────────────────

export async function extractAndStoreGlossarySuggestions(options: ExtractorOptions): Promise<void> {
  if (!isOpenAiConfigured()) return;
  if (options.lines.length === 0) return;

  try {
    const artistKey = normalizeArtistKey(options.artist);

    // Read both accepted glossary AND pending suggestions so the AI skips all known terms
    const [glossaryFile, pendingSuggestions] = await Promise.all([
      readArtistGlossaryFile(artistKey).catch(() => ({ entries: [] as AiGlossaryEntry[], displayName: options.artist, artistKey, updatedAt: new Date().toISOString() })),
      readPendingSuggestions(artistKey).catch(() => []),
    ]);

    // Increment use counts for existing terms that appear in this song's lyrics
    void incrementGlossaryTermUseCounts(
      artistKey,
      options.lines.map((l) => l.original)
    ).catch(() => null);

    const enrichedOptions: ExtractorOptions = {
      ...options,
      existingGlossary: glossaryFile.entries,
      pendingSuggestionTerms: pendingSuggestions.map((s) => s.term),
    };

    const raw = await callExtraction(enrichedOptions);
    if (raw.length === 0) return;

    // Auto-add directly to the accepted glossary — no review queue
    const entries: AiGlossaryEntry[] = raw.map((r) => ({
      term: r.term,
      meaning: r.meaning,
      category: r.category as AiGlossaryEntry["category"],
    }));

    await bulkAddGlossaryTerms(
      artistKey,
      glossaryFile.displayName || options.artist,
      entries
    );
  } catch {
    // Non-fatal — never block generation pipeline
  }
}
