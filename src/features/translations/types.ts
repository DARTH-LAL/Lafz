export type TranslationLine = {
  startMs: number;
  endMs: number;
  original: string;
  translated: string;
  transliteration?: string;
  note?: string;
};

export type TrackTranslation = {
  spotifyTrackId: string;
  title: string;
  artist: string;
  sourceLanguage: string;
  targetLanguage: string;
  lines: TranslationLine[];
};

export type TranslationStubFile = {
  spotify_track_id: string;
  language: string | null;
  lines: [];
};

export type TranslationFileKind = "missing" | "stub" | "translated" | "malformed";

export type TranslationFileInspection = {
  exists: boolean;
  filePath: string;
  kind: TranslationFileKind;
  lineCount: number;
  published: boolean;
  lastModifiedAt: string | null;
  language: string | null;
  preview: string | null;
  parsedJson: unknown | null;
  parseError: string | null;
};
