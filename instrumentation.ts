export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { ensureVocabularyAgentWorkerStarted } = await import("@/features/brain/vocabulary-agent");
  const { ensureCleanupAgentWorkerStarted } = await import("@/features/brain/cleanup-agent");
  ensureVocabularyAgentWorkerStarted();
  ensureCleanupAgentWorkerStarted();
}
