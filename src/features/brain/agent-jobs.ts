import type { AiTranslationDraftFile } from "@/features/ai/types";
import { enqueueAgentJob } from "@/features/brain/repository";
import { splitArtistCredits, uniqStrings } from "@/features/brain/normalize";

type EnqueueVocabularyAgentJobOptions = {
  draftFile: AiTranslationDraftFile;
  songNodeId: string;
};

type EnqueueCleanupAgentJobOptions = {
  draftFile: AiTranslationDraftFile;
  songNodeId: string;
};

const CLEANUP_AGENT_JOB_VERSION = "v2";

function buildVocabularyAgentJobKey(draftFile: AiTranslationDraftFile) {
  return ["vocabulary_agent", draftFile.spotifyTrackId, draftFile.generatedAt].join("::");
}

function buildVocabularyAgentArtistKeys(draftFile: AiTranslationDraftFile) {
  return uniqStrings(splitArtistCredits(draftFile.artist).map((credit) => credit.key));
}

function buildCleanupAgentJobKey(draftFile: AiTranslationDraftFile) {
  return ["cleanup_agent", CLEANUP_AGENT_JOB_VERSION, draftFile.spotifyTrackId, draftFile.generatedAt].join("::");
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

export async function enqueueCleanupAgentJob(options: EnqueueCleanupAgentJobOptions) {
  const { draftFile, songNodeId } = options;

  const job = await enqueueAgentJob({
    jobKey: buildCleanupAgentJobKey(draftFile),
    jobType: "cleanup_agent",
    scopeType: "song",
    scopeKey: draftFile.spotifyTrackId,
    spotifyTrackId: draftFile.spotifyTrackId,
    priority: 90,
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
    const { ensureCleanupAgentWorkerStarted, kickCleanupAgentWorker } = await import("@/features/brain/cleanup-agent");
    ensureCleanupAgentWorkerStarted();
    kickCleanupAgentWorker("enqueue");
  }

  return job;
}
