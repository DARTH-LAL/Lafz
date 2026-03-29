import type { AiGlossaryEntry } from "@/features/ai/glossary";

export type AiTranslationDraftMode = "synced" | "plain";
export type AiTranslationConfidence = "low" | "medium" | "high";

export type AiSongContext = {
  summary: string;
  themes: string[];
  tone: string;
  notablePhrases: string[];
  speaker: string | null;
  addressee: string | null;
  stance: string | null;
  narrativeMode: string | null;
};

export type AiCorrectionExample = {
  original: string;
  chosen: string;
  note: string | null;
  updatedAt?: string | null;
  useCount?: number | null;
};

export type AiArtistMemory = {
  artistKey: string;
  displayName: string;
  personaSummary: string | null;
  translationPreferences: string[];
  translationDirectives: string[];
  recurringThemes: string[];
  recurringMotifs: string[];
  relationshipPatterns: string[];
  toneNotes: string[];
  voiceNotes: string[];
  stanceNotes: string[];
  perspectiveNotes: string[];
  notes: string[];
  glossaryEntries: AiGlossaryEntry[];
};

export type AiCorrectionHint = {
  original: string;
  chosen: string;
  note: string | null;
  source: "current_song" | "track_memory" | "artist_memory";
  similarity: "exact" | "high" | "medium";
};

export type AiDraftLine = {
  order: number;
  original: string;
  normalizedOriginal: string | null;
  normalizationNotes: string[];
  meaning: string;
  impliedMeaning: string | null;
  register: string | null;
  literal: string;
  natural: string;
  slangAware: string;
  chosen: string;
  translated: string;
  transliteration: string | null;
  note: string | null;
  ambiguity: string | null;
  confidence: AiTranslationConfidence;
  selectorReason: string | null;
  startMs: number | null;
  endMs: number | null;
};

export type AiTranslationDraftFile = {
  spotifyTrackId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  sourceLanguage: string;
  targetLanguage: string;
  generatedAt: string;
  mode: AiTranslationDraftMode;
  sourceLyricsKind: AiTranslationDraftMode;
  generator: {
    provider: "ollama" | "openai" | "multi";
    model: string;
  };
  songContext: AiSongContext | null;
  artistMemory: AiArtistMemory | null;
  lines: AiDraftLine[];
};

export type AiProviderStatus = {
  provider: "ollama" | "openai";
  baseUrl: string;
  model: string;
  available: boolean;
  modelAvailable: boolean;
  installedModels: string[];
  errorMessage: string | null;
};

export type AiTranslationDraftInspection = {
  exists: boolean;
  filePath: string;
  mode: AiTranslationDraftMode | "missing" | "malformed";
  lineCount: number;
  lowConfidenceCount: number;
  mediumConfidenceCount: number;
  highConfidenceCount: number;
  manualReviewCount: number;
  lastModifiedAt: string | null;
  sourceLanguage: string | null;
  targetLanguage: string | null;
  model: string | null;
  preview: string | null;
  parseError: string | null;
};

export type GeneratedTranslationLineDraft = {
  meaning: string;
  impliedMeaning: string | null;
  register: string | null;
  literal: string;
  natural: string;
  slangAware: string;
  chosen: string;
  translated: string;
  transliteration: string | null;
  note: string | null;
  ambiguity: string | null;
  confidence: AiTranslationConfidence;
  selectorReason: string | null;
};

export type GenerateAiTranslationOptions = {
  spotifyTrackId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  sourceLanguage: string | null;
  targetLanguage: string;
  includeTransliteration: boolean;
  includeNotes: boolean;
  overwriteExistingTranslation: boolean;
};

export type AiCostSummary = {
  generatorA: { model: string; inputTokens: number; outputTokens: number; costUsd: number };
  generatorB: { model: string; inputTokens: number; outputTokens: number; costUsd: number };
  judge:      { model: string; inputTokens: number; outputTokens: number; costUsd: number };
  totalCostUsd: number;
};

export type GenerateAiTranslationResult =
  | {
      status: "saved_translation";
      draftFilePath: string;
      translationFilePath: string;
      lineCount: number;
      costSummary?: AiCostSummary;
    }
  | {
      status: "draft_only_plain";
      draftFilePath: string;
      lineCount: number;
      costSummary?: AiCostSummary;
    }
  | {
      status: "draft_only_preserved";
      draftFilePath: string;
      translationFilePath: string;
      lineCount: number;
      costSummary?: AiCostSummary;
    }
  | {
      status: "missing_lyrics";
    }
  | {
      status: "missing_ai_config";
    }
  | {
      status: "provider_unavailable";
    }
  | {
      status: "model_missing";
    };

export type MeaningAnalysisLine = {
  meaning: string;
  impliedMeaning: string | null;
  register: string | null;
};
