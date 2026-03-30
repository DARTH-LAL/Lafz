import { readCloudDataJson, writeCloudDataJson } from "@/features/cloud/data-store";
import { DEFAULT_SETTINGS } from "@/features/settings/types";
import type { LafzSettings } from "@/features/settings/types";

const SETTINGS_STORAGE_PATH = "data/settings.json";

let settingsCache: LafzSettings | null = null;
let settingsLoadPromise: Promise<LafzSettings> | null = null;

function parseSettings(raw: unknown): LafzSettings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS };
  const obj = raw as Record<string, unknown>;
  return {
    generatorAModel: typeof obj.generatorAModel === "string" ? obj.generatorAModel : DEFAULT_SETTINGS.generatorAModel,
    generatorBModel: typeof obj.generatorBModel === "string" ? obj.generatorBModel : DEFAULT_SETTINGS.generatorBModel,
    judgeModel: typeof obj.judgeModel === "string" ? obj.judgeModel : DEFAULT_SETTINGS.judgeModel,
    targetLanguage: typeof obj.targetLanguage === "string" ? obj.targetLanguage : DEFAULT_SETTINGS.targetLanguage,
    translationStyle: ["balanced", "literal", "poetic", "cultural"].includes(obj.translationStyle as string)
      ? (obj.translationStyle as LafzSettings["translationStyle"])
      : DEFAULT_SETTINGS.translationStyle,
    autoApproveThreshold: typeof obj.autoApproveThreshold === "number" ? obj.autoApproveThreshold : DEFAULT_SETTINGS.autoApproveThreshold,
    autoFetchLyrics: typeof obj.autoFetchLyrics === "boolean" ? obj.autoFetchLyrics : DEFAULT_SETTINGS.autoFetchLyrics,
    keepBothDrafts: typeof obj.keepBothDrafts === "boolean" ? obj.keepBothDrafts : DEFAULT_SETTINGS.keepBothDrafts,
    monthlySpendLimit: typeof obj.monthlySpendLimit === "number" ? obj.monthlySpendLimit : DEFAULT_SETTINGS.monthlySpendLimit,
    alertThreshold: typeof obj.alertThreshold === "number" ? obj.alertThreshold : DEFAULT_SETTINGS.alertThreshold,
    defaultView: obj.defaultView === "list" ? "list" : "grid",
    defaultSort: ["status", "recently_updated", "title", "artist"].includes(obj.defaultSort as string)
      ? (obj.defaultSort as LafzSettings["defaultSort"])
      : DEFAULT_SETTINGS.defaultSort,
    showNoLyricsTracks: typeof obj.showNoLyricsTracks === "boolean" ? obj.showNoLyricsTracks : DEFAULT_SETTINGS.showNoLyricsTracks,
  };
}

async function loadSettingsFromCloud() {
  const raw = await readCloudDataJson<unknown>(SETTINGS_STORAGE_PATH);
  const settings = parseSettings(raw);
  settingsCache = settings;
  return settings;
}

export function readSettingsSync(): LafzSettings {
  return settingsCache ? { ...settingsCache } : { ...DEFAULT_SETTINGS };
}

export async function readSettings(): Promise<LafzSettings> {
  if (settingsCache) {
    return { ...settingsCache };
  }

  if (!settingsLoadPromise) {
    settingsLoadPromise = loadSettingsFromCloud().finally(() => {
      settingsLoadPromise = null;
    });
  }

  return { ...(await settingsLoadPromise) };
}

export async function writeSettings(settings: LafzSettings): Promise<void> {
  const nextSettings = parseSettings(settings);
  settingsCache = nextSettings;
  await writeCloudDataJson(SETTINGS_STORAGE_PATH, nextSettings);
}

void readSettings().catch((error) => {
  console.error("Could not preload Lafz settings from cloud storage.", error);
});
