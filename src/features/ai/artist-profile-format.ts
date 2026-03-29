import type { AiArtistMemory } from "@/features/ai/types";

export function buildArtistMemoryPromptSnippet(memory: AiArtistMemory | null) {
  if (!memory) {
    return null;
  }

  const glossaryHighlights = memory.glossaryEntries
    .slice(0, 8)
    .map((entry) => `${entry.term} → ${entry.meaning}`)
    .join(" | ");

  return [
    `Artist profile for ${memory.displayName}: persona=${memory.personaSummary ?? "unknown"}`,
    `translationPreferences=${memory.translationPreferences.join(" | ") || "none"}`,
    `translationDirectives=${memory.translationDirectives.join(" | ") || "none"}`,
    `recurringThemes=${memory.recurringThemes.join(" | ") || "none"}`,
    `recurringMotifs=${memory.recurringMotifs.join(" | ") || "none"}`,
    `relationshipPatterns=${memory.relationshipPatterns.join(" | ") || "none"}`,
    `toneNotes=${memory.toneNotes.join(" | ") || "none"}`,
    `voiceNotes=${memory.voiceNotes.join(" | ") || "none"}`,
    `stanceNotes=${memory.stanceNotes.join(" | ") || "none"}`,
    `perspectiveNotes=${memory.perspectiveNotes.join(" | ") || "none"}`,
    `notes=${memory.notes.join(" | ") || "none"}`,
    `glossaryCount=${memory.glossaryEntries.length}`,
    `glossaryHighlights=${glossaryHighlights || "none"}`
  ].join("; ");
}

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
    glossaryCount: memory.glossaryEntries.length,
    glossaryHighlights: memory.glossaryEntries.slice(0, 12).map((entry) => ({
      term: entry.term,
      meaning: entry.meaning,
      category: entry.category ?? "entry"
    }))
  };
}
