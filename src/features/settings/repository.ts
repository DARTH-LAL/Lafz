import fs from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_SETTINGS } from "@/features/settings/types";
import type { LafzSettings } from "@/features/settings/types";

const SETTINGS_PATH = path.join(process.cwd(), "data", "settings.json");

function parseSettings(raw: unknown): LafzSettings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS };
  const obj = raw as Record<string, unknown>;
  return {
    generatorAModel: typeof obj.generatorAModel === "string" ? obj.generatorAModel : DEFAULT_SETTINGS.generatorAModel,
    generatorBModel: typeof obj.generatorBModel === "string" ? obj.generatorBModel : DEFAULT_SETTINGS.generatorBModel,
    judgeModel: typeof obj.judgeModel === "string" ? obj.judgeModel : DEFAULT_SETTINGS.judgeModel,
    targetLanguage: typeof obj.targetLanguage === "string" ? obj.targetLanguage : DEFAULT_SETTINGS.targetLanguage,
    translationStyle: ["balanced","literal","poetic","cultural"].includes(obj.translationStyle as string) ? obj.translationStyle as LafzSettings["translationStyle"] : DEFAULT_SETTINGS.translationStyle,
    autoApproveThreshold: typeof obj.autoApproveThreshold === "number" ? obj.autoApproveThreshold : DEFAULT_SETTINGS.autoApproveThreshold,
    autoFetchLyrics: typeof obj.autoFetchLyrics === "boolean" ? obj.autoFetchLyrics : DEFAULT_SETTINGS.autoFetchLyrics,
    keepBothDrafts: typeof obj.keepBothDrafts === "boolean" ? obj.keepBothDrafts : DEFAULT_SETTINGS.keepBothDrafts,
    monthlySpendLimit: typeof obj.monthlySpendLimit === "number" ? obj.monthlySpendLimit : DEFAULT_SETTINGS.monthlySpendLimit,
    alertThreshold: typeof obj.alertThreshold === "number" ? obj.alertThreshold : DEFAULT_SETTINGS.alertThreshold,
    defaultView: obj.defaultView === "list" ? "list" : "grid",
    defaultSort: ["status","recently_updated","title","artist"].includes(obj.defaultSort as string) ? obj.defaultSort as LafzSettings["defaultSort"] : DEFAULT_SETTINGS.defaultSort,
    showNoLyricsTracks: typeof obj.showNoLyricsTracks === "boolean" ? obj.showNoLyricsTracks : DEFAULT_SETTINGS.showNoLyricsTracks,
  };
}

/** Sync read — used in AI model getters at request time */
export function readSettingsSync(): LafzSettings {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf-8");
    return parseSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function readSettings(): Promise<LafzSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, "utf-8");
    return parseSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(settings: LafzSettings): Promise<void> {
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}
