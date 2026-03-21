export type TimingEditorLine = {
  order: number;
  original: string;
  translated: string;
  transliteration: string | null;
  note: string | null;
  startMs: number | null;
  endMs: number | null;
};

export type TimingEditorDocumentSource = "translation" | "ai_draft" | "lyrics_cache";

export type TimingEditorDocument = {
  spotifyTrackId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  sourceLanguage: string;
  targetLanguage: string;
  source: TimingEditorDocumentSource;
  lines: TimingEditorLine[];
};
