import type { AiGlossaryEntry } from "@/features/ai/glossary";
import { normalizeArtistKey, storePendingSuggestions, type PendingGlossarySuggestion } from "@/features/ai/glossary-repository";
import { getOpenAiBaseUrl, getOpenAiModel, isOpenAiConfigured } from "@/features/ai/openai";

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
  const existingTerms = options.existingGlossary.map((e) => e.term).join(", ") || "none";
  return [
    `You are a vocabulary extractor for Lafz, a personal lyric translation tool.`,
    `You are analyzing lyrics by ${options.artist} translated from ${language} to English.`,
    `Your task: identify terms that should be stored in the artist's permanent glossary — words or phrases with artist-specific usage, recurring slang, idioms, cultural references, or preferred renderings that are non-obvious and would help future translations be more accurate and consistent.`,
    `Focus on: terms where the translation captures something non-literal or artist-specific; slang with a fixed meaning for this artist; phrases this artist uses in a distinctive way; recurring vocabulary across multiple lines.`,
    `Do NOT suggest: common English words, generic translations, words already in the glossary, or obvious direct translations.`,
    `Already in glossary (skip these): ${existingTerms}.`,
    `Return at most 12 terms. If no strong candidates exist, return an empty array.`,
    `For each term, provide the original-language word/phrase, its preferred English meaning, its category (preferred_rendering | slang | idiom | phrase | reference | entry), and a short one-sentence reason explaining why it's worth storing.`
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

  const model = getOpenAiModel();
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
    .slice(0, 12);
}

// ── Public entry point ─────────────────────────────────────────────────────

export async function extractAndStoreGlossarySuggestions(options: ExtractorOptions): Promise<void> {
  if (!isOpenAiConfigured()) return;
  if (options.lines.length === 0) return;

  try {
    const raw = await callExtraction(options);
    if (raw.length === 0) return;

    const artistKey = normalizeArtistKey(options.artist);
    const now = new Date().toISOString();

    const suggestions: PendingGlossarySuggestion[] = raw.map((r) => ({
      term: r.term,
      meaning: r.meaning,
      category: r.category as AiGlossaryEntry["category"],
      reason: r.reason,
      sourceSongId: options.spotifyTrackId,
      suggestedAt: now,
    }));

    await storePendingSuggestions(artistKey, suggestions);
  } catch {
    // Non-fatal — never block generation pipeline
  }
}
