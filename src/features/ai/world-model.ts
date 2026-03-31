import type { AiVerseState, AiWorldModel, AiWorldModelLine } from "@/features/ai/types";

export function buildWorldModelLineLookup(worldModel: AiWorldModel | null | undefined) {
  const lookup = new Map<number, AiWorldModelLine>();

  for (const line of worldModel?.lineModels ?? []) {
    lookup.set(line.order, line);
  }

  return lookup;
}

export function deriveVerseStatesFromWorldModel(worldModel: AiWorldModel | null | undefined): AiVerseState[] {
  return (worldModel?.verseModels ?? []).map((verse) => ({
    groupIndex: verse.groupIndex,
    startOrder: verse.startOrder,
    endOrder: verse.endOrder,
    summary: verse.sceneSummary,
    stance: verse.stance,
    target: verse.target,
    dominantIntents: verse.dominantIntents,
    tension: verse.tension,
    caution: verse.continuityNote ?? verse.powerMove
  }));
}
