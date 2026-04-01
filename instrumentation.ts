export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { ensureVocabularyAgentWorkerStarted } = await import("@/features/brain/vocabulary-agent");
  ensureVocabularyAgentWorkerStarted();
}
