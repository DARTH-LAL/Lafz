export type LafzSettings = {
  // AI Pipeline
  generatorAModel: string;
  generatorBModel: string;
  judgeModel: string;

  // Translation Defaults
  targetLanguage: string;
  translationStyle: "balanced" | "literal" | "poetic" | "cultural";
  autoApproveThreshold: number; // 50–100
  autoFetchLyrics: boolean;
  keepBothDrafts: boolean;

  // Budget
  monthlySpendLimit: number;
  alertThreshold: number; // 10–100

  // Library
  defaultView: "grid" | "list";
  defaultSort: "status" | "recently_updated" | "title" | "artist";
  showNoLyricsTracks: boolean;
};

export const DEFAULT_SETTINGS: LafzSettings = {
  generatorAModel: "gpt-5.4-mini",
  generatorBModel: "claude-sonnet-4-20250514",
  judgeModel: "gemini-2.5-flash",
  targetLanguage: "English",
  translationStyle: "balanced",
  autoApproveThreshold: 85,
  autoFetchLyrics: true,
  keepBothDrafts: false,
  monthlySpendLimit: 10,
  alertThreshold: 80,
  defaultView: "grid",
  defaultSort: "status",
  showNoLyricsTracks: true,
};
