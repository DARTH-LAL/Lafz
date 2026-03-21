export type AiTranslationDraftMode = "synced" | "plain";

export type AiDraftLine = {
  order: number;
  original: string;
  translated: string;
  transliteration: string | null;
  note: string | null;
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
  translated: string;
  transliteration: string | null;
  note: string | null;
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
