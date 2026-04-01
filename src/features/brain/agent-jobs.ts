import type { AiTranslationDraftFile } from "@/features/ai/types";
import { enqueueAgentJob } from "@/features/brain/repository";
import { splitArtistCredits, uniqStrings } from "@/features/brain/normalize";

type EnqueueVocabularyAgentJobOptions = {
  draftFile: AiTranslationDraftFile;
  songNodeId: string;
};

function buildVocabularyAgentJobKey(draftFile: AiTranslationDraftFile) {
  return ["vocabulary_agent", draftFile.spotifyTrackId, draftFile.generatedAt].join("::");
}

function buildVocabularyAgentArtistKeys(draftFile: AiTranslationDraftFile) {
  return uniqStrings(splitArtistCredits(draftFile.artist).map((credit) => credit.key));
}

export async function enqueueVocabularyAgentJob(options: EnqueueVocabularyAgentJobOptions) {
  const { draftFile, songNodeId } = options;

  const job = await enqueueAgentJob({
    jobKey: buildVocabularyAgentJobKey(draftFile),
    jobType: "vocabulary_agent",
    scopeType: "song",
    scopeKey: draftFile.spotifyTrackId,
    spotifyTrackId: draftFile.spotifyTrackId,
    priority: 60,
    payload: {
      spotifyTrackId: draftFile.spotifyTrackId,
      songNodeId,
      title: draftFile.title,
      artist: draftFile.artist,
      artistKeys: buildVocabularyAgentArtistKeys(draftFile),
      sourceLanguage: draftFile.sourceLanguage,
      targetLanguage: draftFile.targetLanguage,
      lineCount: draftFile.lines.length,
      generatedAt: draftFile.generatedAt,
      generatorModel: draftFile.generator.model
    }
  });

  if (job) {
    const { ensureVocabularyAgentWorkerStarted, kickVocabularyAgentWorker } = await import("@/features/brain/vocabulary-agent");
    ensureVocabularyAgentWorkerStarted();
    kickVocabularyAgentWorker("enqueue");
  }

  return job;
}
