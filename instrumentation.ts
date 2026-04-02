export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { ensureVocabularyAgentWorkerStarted } = await import("@/features/brain/vocabulary-agent");
  const { ensureEntityAgentWorkerStarted } = await import("@/features/brain/entity-agent");
  const { ensureMotifAgentWorkerStarted } = await import("@/features/brain/motif-agent");
  const { ensurePersonaAgentWorkerStarted } = await import("@/features/brain/persona-agent");
  const { ensureCleanupAgentWorkerStarted } = await import("@/features/brain/cleanup-agent");
  ensureVocabularyAgentWorkerStarted();
  ensureEntityAgentWorkerStarted();
  ensureMotifAgentWorkerStarted();
  ensurePersonaAgentWorkerStarted();
  ensureCleanupAgentWorkerStarted();
}
