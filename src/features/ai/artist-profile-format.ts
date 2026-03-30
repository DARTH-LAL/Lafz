import type { AiArtistMemory } from "@/features/ai/types";

// ── Glossary priority sort ─────────────────────────────────────────────────
// Ensures the most actionable terms surface first in highlights:
// preferred_rendering (hard rules) → phrase → idiom → slang → reference → entry
// Ties broken by use count descending — proven terms rank above untested ones.

const CATEGORY_PRIORITY: Record<string, number> = {
  preferred_rendering: 0,
  phrase:              1,
  idiom:               2,
  slang:               3,
  reference:           4,
  entry:               5,
};

function sortGlossaryEntries(entries: AiArtistMemory["glossaryEntries"]) {
  return [...entries].sort((a, b) => {
    const pa = CATEGORY_PRIORITY[a.category ?? "entry"] ?? 5;
    const pb = CATEGORY_PRIORITY[b.category ?? "entry"] ?? 5;
    if (pa !== pb) return pa - pb;
    return (b.useCount ?? 0) - (a.useCount ?? 0);
  });
}

// ── Prompt snippet (system-prompt string) ─────────────────────────────────

export function buildArtistMemoryPromptSnippet(memory: AiArtistMemory | null) {
  if (!memory) {
    return null;
  }

  const sorted = sortGlossaryEntries(memory.glossaryEntries);
  const glossaryHighlights = sorted
    .slice(0, 8)
    .map((e) => `${e.term} → ${e.meaning}`)
    .join(" | ");

  const canonicalPart = memory.canonicalRenderings && memory.canonicalRenderings.length > 0
    ? `canonicalRenderings (HARD RULES — always use these exact English forms)=${
        memory.canonicalRenderings.map((r) => `"${r.term}" → "${r.rendering}"`).join(" | ")
      }`
    : null;

  return [
    `Artist profile for ${memory.displayName}: persona=${memory.personaSummary ?? "unknown"}`,
    `translationPreferences (style guidance — apply these to every line)=${memory.translationPreferences.join(" | ") || "none"}`,
    `translationDirectives (strict rules — never violate these)=${memory.translationDirectives.join(" | ") || "none"}`,
    `recurringThemes (appears repeatedly — preserve thematic weight when present)=${memory.recurringThemes.join(" | ") || "none"}`,
    `recurringMotifs (recurring images — keep metaphors consistent, do not substitute)=${memory.recurringMotifs.join(" | ") || "none"}`,
    `relationshipPatterns (how artist addresses lovers, rivals, crew — match the social posture)=${memory.relationshipPatterns.join(" | ") || "none"}`,
    `toneNotes (emotional register — do not flatten proud/aggressive/tender lines)=${memory.toneNotes.join(" | ") || "none"}`,
    `voiceNotes (how the English should sound — match this register in every line)=${memory.voiceNotes.join(" | ") || "none"}`,
    `stanceNotes (speaker authority and social position — preserve dominance, vulnerability, etc.)=${memory.stanceNotes.join(" | ") || "none"}`,
    `perspectiveNotes (who is speaking, to whom — never shift the speaker's point of view)=${memory.perspectiveNotes.join(" | ") || "none"}`,
    `notes=${memory.notes.join(" | ") || "none"}`,
    canonicalPart,
    `glossaryCount=${memory.glossaryEntries.length}`,
    `glossaryHighlights (top terms by importance)=${glossaryHighlights || "none"}`,
  ].filter(Boolean).join("; ");
}

// ── Full serialised object (user-prompt JSON) ──────────────────────────────

export function serializeArtistMemoryForPrompt(memory: AiArtistMemory | null) {
  if (!memory) {
    return null;
  }

  return {
    artistKey: memory.artistKey,
    displayName: memory.displayName,
    personaSummary: memory.personaSummary,
    translationPreferences: memory.translationPreferences,
    translationDirectives: memory.translationDirectives,
    recurringThemes: memory.recurringThemes,
    recurringMotifs: memory.recurringMotifs,
    relationshipPatterns: memory.relationshipPatterns,
    toneNotes: memory.toneNotes,
    voiceNotes: memory.voiceNotes,
    stanceNotes: memory.stanceNotes,
    perspectiveNotes: memory.perspectiveNotes,
    notes: memory.notes,
    // Canonical renderings are hard rules — always use these exact English forms
    ...(memory.canonicalRenderings && memory.canonicalRenderings.length > 0
      ? { canonicalRenderings: memory.canonicalRenderings }
      : {}),
    glossaryCount: memory.glossaryEntries.length,
  };
}
