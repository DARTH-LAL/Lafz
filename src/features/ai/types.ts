export type AiTranslationDraftMode = "synced" | "plain";
export type AiTranslationConfidence = "low" | "medium" | "high";

export type AiSongContext = {
  summary: string;
  themes: string[];
  tone: string;
  notablePhrases: string[];
};

export type AiArtistMemory = {
  artistKey: string;
  displayName: string;
  translationPreferences: string[];
  recurringThemes: string[];
  toneNotes: string[];
  notes: string[];
};

export type AiCorrectionExample = {
  original: string;
  chosen: string;
  note: string | null;
  updatedAt?: string | null;
  useCount?: number | null;
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
    provider: "ollama" | "openai";
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
  lastModifiedAt: string | null;
  sourceLanguage: string | null;
  targetLanguage: string | null;
  model: string | null;
  preview: string | null;
  parseError: string | null;
};

export type GeneratedTranslationLineDraft = {
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

export type GenerateAiTranslationResult =
  | {
      status: "saved_translation";
      draftFilePath: string;
      translationFilePath: string;
      lineCount: number;
    }
  | {
      status: "draft_only_plain";
      draftFilePath: string;
      lineCount: number;
    }
  | {
      status: "draft_only_preserved";
      draftFilePath: string;
      translationFilePath: string;
      lineCount: number;
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
