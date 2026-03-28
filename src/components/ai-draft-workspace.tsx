"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { FloatingToast } from "@/components/floating-toast";
import type { AiCostSummary, AiProviderStatus, AiTranslationDraftFile, AiTranslationDraftInspection } from "@/features/ai/types";
import type { TranslationFileKind } from "@/features/translations/types";

type AiDraftWorkspaceProps = {
  track: {
    spotifyTrackId: string;
    title: string;
    artist: string;
    album: string;
    durationMs: number;
    defaultSourceLanguage: string;
  };
  lyricsKind: "synced" | "plain" | "missing" | "malformed";
  lyricsLanguage: string | null;
  translationKind: TranslationFileKind;
  aiConfigured: boolean;
  aiModel: string;
  aiProviderStatus: AiProviderStatus;
  initialDraft: AiTranslationDraftFile | null;
  initialInspection: AiTranslationDraftInspection;
  initialMessage: string | null;
  initialStatus: string;
};

type EditableDraftLine = {
  order: number;
  original: string;
  chosen: string;
  confidence: "low" | "medium" | "high";
};

function getAiProviderLabel(provider: AiProviderStatus["provider"]) {
  return provider === "openai" ? "OpenAI" : "Ollama";
}

function toEditableDraftLine(line: AiTranslationDraftFile["lines"][number]): EditableDraftLine {
  return { order: line.order, original: line.original, chosen: line.chosen, confidence: line.confidence };
}

function sleep(ms: number) {
  return new Promise((resolve) => { window.setTimeout(resolve, ms); });
}

export function AiDraftWorkspace({
  track,
  lyricsKind,
  lyricsLanguage,
  translationKind,
  aiConfigured,
  aiModel,
  aiProviderStatus,
  initialDraft,
  initialInspection,
  initialMessage,
  initialStatus
}: AiDraftWorkspaceProps) {
  const router = useRouter();
  const [sourceLanguage, setSourceLanguage] = useState(lyricsLanguage ?? (track.defaultSourceLanguage !== "unknown" ? track.defaultSourceLanguage : ""));
  const [targetLanguage, setTargetLanguage] = useState(initialDraft?.targetLanguage ?? "English");
  const [includeTransliteration, setIncludeTransliteration] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [overwriteExistingTranslation, setOverwriteExistingTranslation] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [message, setMessage] = useState(initialMessage);
  const [messageTone, setMessageTone] = useState<"success" | "error">(initialStatus === "error" ? "error" : "success");
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [costSummary, setCostSummary] = useState<AiCostSummary | null>(null);
  const [draftLines, setDraftLines] = useState<EditableDraftLine[]>(() => (initialDraft ? initialDraft.lines.map(toEditableDraftLine) : []));

  const canGenerate = aiConfigured && (lyricsKind === "synced" || lyricsKind === "plain");

  useEffect(() => {
    setDraftLines(initialDraft ? initialDraft.lines.map(toEditableDraftLine) : []);
  }, [initialDraft?.generatedAt, initialDraft?.spotifyTrackId]);

  useEffect(() => {
    if (initialMessage) {
      setMessage(initialMessage);
      setMessageTone(initialStatus === "error" ? "error" : "success");
    }
  }, [initialMessage, initialStatus]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 3500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.set("spotifyTrackId", track.spotifyTrackId);
      formData.set("title", track.title);
      formData.set("artist", track.artist);
      formData.set("album", track.album);
      formData.set("durationMs", track.durationMs.toString());
      formData.set("redirectTo", `/library/track/${track.spotifyTrackId}`);

      if (sourceLanguage.trim()) {
        formData.set("sourceLanguage", sourceLanguage.trim());
      }

      formData.set("targetLanguage", targetLanguage.trim() || "English");

      if (includeTransliteration) {
        formData.set("includeTransliteration", "on");
      }

      if (includeNotes) {
        formData.set("includeNotes", "on");
      }

      if (overwriteExistingTranslation) {
        formData.set("overwriteExistingTranslation", "on");
      }

      const response = await fetch("/api/ai/generate-translation", {
        method: "POST",
        headers: {
          "x-lafz-response": "json"
        },
        body: formData
      });

      const payload = (await response.json()) as {
        success: boolean;
        status: string;
        message: string;
        detail?: string;
        jobId?: string;
      };

      if (!response.ok || !payload.success) {
        throw new Error(payload.detail ?? payload.message ?? "Could not generate the AI draft.");
      }

      if (!payload.jobId) {
        throw new Error("Lafz could not start the AI draft job.");
      }

      setMessage("Running 3-model pipeline — GPT-5.1 drafting...");
      setMessageTone("success");

      const pipelineMessages = [
        "Running 3-model pipeline — GPT-5.1 drafting...",
        "Generator A (GPT-5.1) processing lyrics...",
        "Handing off to Generator B (Claude Sonnet)...",
        "Generator B (Claude) refining translations...",
        "Sending both drafts to Gemini judge...",
        "Gemini evaluating and selecting best lines...",
        "Almost done — finalising translation...",
        "Still working — large tracks take a few minutes...",
        "Wrapping up the 3-model evaluation..."
      ];

      // 400 attempts × 2s = 800s (~13 min) — enough for the full 3-model pipeline
      for (let attempt = 0; attempt < 400; attempt += 1) {
        await sleep(2000);

        // Update the status message every ~30s to show progress
        const messageIndex = Math.min(Math.floor(attempt / 15), pipelineMessages.length - 1);
        setMessage(pipelineMessages[messageIndex]);

        const statusResponse = await fetch(`/api/ai/generate-translation/status?jobId=${encodeURIComponent(payload.jobId)}`, {
          headers: {
            "x-lafz-response": "json"
          },
          cache: "no-store"
        });

        const statusPayload = (await statusResponse.json()) as {
          success?: boolean;
          error?: string;
          job?: {
            status: "running" | "succeeded" | "failed";
            message: string | null;
            detail: string | null;
            costSummary: AiCostSummary | null;
          };
        };

        if (!statusResponse.ok || !statusPayload.success || !statusPayload.job) {
          throw new Error(statusPayload.error ?? "Could not read the AI draft job status.");
        }

        if (statusPayload.job.status === "running") {
          continue;
        }

        if (statusPayload.job.status === "failed") {
          throw new Error(statusPayload.job.detail ?? statusPayload.job.message ?? "Could not generate the AI draft.");
        }

        const nextMessage = statusPayload.job.message ?? "Lafz generated the AI draft.";
        setMessage(nextMessage);
        setMessageTone("success");
        if (statusPayload.job.costSummary) {
          setCostSummary(statusPayload.job.costSummary);
        }
        setToast({
          message: nextMessage,
          tone: "success"
        });
        router.refresh();
        return;
      }

      throw new Error("The AI draft timed out after 13 minutes. The track may have too many lines — try again or check the server logs.");
    } catch (error) {
      const nextMessage = error instanceof Error ? error.message : "Could not generate the AI draft.";
      setMessage(nextMessage);
      setMessageTone("error");
      setToast({
        message: nextMessage,
        tone: "error"
      });
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="mt-6">
      {toast ? <FloatingToast message={toast.message} tone={toast.tone} /> : null}

      {/* AI settings */}
      <section className="rounded-[24px] border border-[rgba(160,60,255,0.18)] bg-[linear-gradient(135deg,rgba(160,60,255,0.06)_0%,rgba(255,20,100,0.04)_100%)] p-6 backdrop-blur-[20px]">
        <p className="text-[10px] font-bold uppercase tracking-[2.2px] text-[rgba(160,60,255,0.70)]">AI Translation</p>
        <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-[rgba(160,60,255,0.25)] bg-[rgba(160,60,255,0.12)] px-3 py-1 text-[12px] font-semibold text-[#c87eff]">
          <span>✦</span> gpt-5.1 + claude-sonnet-4.6 → gemini-2.5-pro
        </div>
        <h2 className="mt-3 text-[22px] font-bold tracking-[-0.5px]">
          Generate a translation draft.
        </h2>
        <p className="mt-2 text-[13px] leading-[1.7] text-[#7a6890]">
          Two models translate in parallel. A third evaluates and picks the best line by line — literal, natural, and slang-aware options included.
        </p>

        {message ? (
          <div
            className={`mt-4 rounded-[14px] p-4 text-[13px] leading-[1.65] ${
              messageTone === "error"
                ? "border border-[rgba(255,160,30,0.20)] bg-[rgba(255,160,30,0.08)] text-[#ffc87a]"
                : "border border-[rgba(255,20,100,0.20)] bg-[rgba(255,20,100,0.08)] text-[#ff6aaa]"
            }`}
          >
            {message}
          </div>
        ) : null}

        {costSummary ? (
          <div className="mt-3 rounded-[16px] border border-[rgba(63,255,170,0.15)] bg-[rgba(63,255,170,0.04)] p-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(63,255,170,0.6)]">This generation cost</p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: costSummary.generatorA.model.replace("gpt-", "GPT-"), color: "#ff4d96", cost: costSummary.generatorA.costUsd, input: costSummary.generatorA.inputTokens, output: costSummary.generatorA.outputTokens },
                { label: costSummary.generatorB.model.split("-")[0] === "claude" ? "Claude" : costSummary.generatorB.model, color: "#a259ff", cost: costSummary.generatorB.costUsd, input: costSummary.generatorB.inputTokens, output: costSummary.generatorB.outputTokens },
                { label: costSummary.judge.model.includes("gemini") ? "Gemini" : costSummary.judge.model, color: "#40e8ff", cost: costSummary.judge.costUsd, input: costSummary.judge.inputTokens, output: costSummary.judge.outputTokens },
              ].map(({ label, color, cost, input, output }) => (
                <div key={label} className="rounded-[12px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-3 text-center">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: `${color}99` }}>{label}</p>
                  <p className="mt-1 text-[18px] font-bold" style={{ color }}>${cost.toFixed(4)}</p>
                  <p className="mt-0.5 text-[10px] text-[rgba(255,255,255,0.3)]">{(input + output).toLocaleString()} tokens</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-[rgba(255,255,255,0.06)] pt-3">
              <span className="text-[12px] text-[rgba(255,255,255,0.35)]">Total</span>
              <span className="text-[18px] font-bold text-[#3fffaa]">${costSummary.totalCostUsd.toFixed(4)}</span>
            </div>
          </div>
        ) : null}

        <div className="mt-4 rounded-[16px] border border-[rgba(160,60,255,0.12)] bg-[rgba(160,60,255,0.05)] p-4 text-[13px] text-[#c8b8d8]">
          <p className="text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(160,60,255,0.55)]">Current AI behavior</p>
          <p className="mt-2">
            {lyricsKind === "synced"
              ? "Synced lyrics detected — draft will include timestamps for karaoke-style playback."
              : lyricsKind === "plain"
                ? "Plain lyrics only — draft will be saved untimed and playback stays in reading mode."
                : "Import lyrics for this track first, then generate a draft."}
          </p>
        </div>

        <div className="mt-3 rounded-[16px] border border-[rgba(160,60,255,0.12)] bg-[rgba(160,60,255,0.05)] p-4 text-[13px] text-[#c8b8d8]">
          <p className="text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(160,60,255,0.55)]">AI provider</p>
          <p className="mt-2">
            Provider: <span className="text-[#fff0f6]">{getAiProviderLabel(aiProviderStatus.provider)}</span>
          </p>
          <p className="mt-1.5">
            Model: <span className="font-mono text-[11px] text-[#fff0f6]">{aiProviderStatus.model}</span>
          </p>
          <p className="mt-1.5">
            Status:{" "}
            <span className={aiProviderStatus.available ? "text-[#3fffaa]" : "text-[#ffc87a]"}>
              {aiProviderStatus.available ? "reachable" : "not reachable"}
            </span>
          </p>
        </div>

        {canGenerate ? (
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-[12px] font-bold uppercase tracking-[1px] text-[rgba(255,20,100,0.70)]">Source language</span>
                <input
                  type="text"
                  value={sourceLanguage}
                  onChange={(event) => { setSourceLanguage(event.target.value); }}
                  placeholder="Auto-detect from lyrics"
                  className="w-full rounded-[14px] border border-[rgba(255,20,100,0.16)] bg-[rgba(255,20,100,0.05)] px-4 py-3 text-[14px] text-white outline-none transition placeholder:text-[#4a3860] focus:border-[rgba(255,20,100,0.50)] focus:shadow-[0_0_0_3px_rgba(255,20,100,0.10)]"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-[12px] font-bold uppercase tracking-[1px] text-[rgba(255,20,100,0.70)]">Target language</span>
                <input
                  type="text"
                  value={targetLanguage}
                  onChange={(event) => { setTargetLanguage(event.target.value); }}
                  className="w-full rounded-[14px] border border-[rgba(255,20,100,0.16)] bg-[rgba(255,20,100,0.05)] px-4 py-3 text-[14px] text-white outline-none transition placeholder:text-[#4a3860] focus:border-[rgba(255,20,100,0.50)] focus:shadow-[0_0_0_3px_rgba(255,20,100,0.10)]"
                />
              </label>
            </div>

            <div className="space-y-3 rounded-[16px] border border-[rgba(255,20,100,0.10)] bg-[rgba(255,20,100,0.04)] p-4 text-[13px] text-[#c8b8d8]">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={includeTransliteration}
                  onChange={(event) => { setIncludeTransliteration(event.target.checked); }}
                  className="mt-0.5 h-4 w-4 rounded border-[rgba(255,20,100,0.30)] bg-transparent accent-[#ff1464]"
                />
                <span>Include transliteration when it helps.</span>
              </label>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={includeNotes}
                  onChange={(event) => { setIncludeNotes(event.target.checked); }}
                  className="mt-0.5 h-4 w-4 rounded border-[rgba(255,20,100,0.30)] bg-transparent accent-[#ff1464]"
                />
                <span>Include slang and cultural notes when needed.</span>
              </label>

              {(translationKind === "translated" || translationKind === "malformed") && lyricsKind === "synced" ? (
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={overwriteExistingTranslation}
                    onChange={(event) => { setOverwriteExistingTranslation(event.target.checked); }}
                    className="mt-0.5 h-4 w-4 rounded border-[rgba(255,20,100,0.30)] bg-transparent accent-[#ff1464]"
                  />
                  <span>Replace the current synced translation file for this track.</span>
                </label>
              ) : null}
            </div>

            {initialDraft?.songContext ? (
              <div className="rounded-[16px] border border-[rgba(160,60,255,0.12)] bg-[rgba(160,60,255,0.05)] p-4 text-[13px] text-[#c8b8d8]">
                <p className="text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(160,60,255,0.55)]">Song context</p>
                <p className="mt-2 text-[#fff0f6]">{initialDraft.songContext.summary}</p>
                <p className="mt-3 text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(160,60,255,0.55)]">Tone</p>
                <p className="mt-1.5">{initialDraft.songContext.tone}</p>
                {initialDraft.songContext.themes.length > 0 ? (
                  <>
                    <p className="mt-3 text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(160,60,255,0.55)]">Themes</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {initialDraft.songContext.themes.map((theme) => (
                        <span key={theme} className="rounded-full border border-[rgba(160,60,255,0.20)] bg-[rgba(160,60,255,0.08)] px-3 py-1 text-[11px] text-[#c87eff]">
                          {theme}
                        </span>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {initialDraft?.artistMemory ? (
              <div className="rounded-[16px] border border-[rgba(160,60,255,0.12)] bg-[rgba(160,60,255,0.05)] p-4 text-[13px] text-[#c8b8d8]">
                <p className="text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(160,60,255,0.55)]">Artist memory</p>
                <p className="mt-2 text-[#fff0f6]">{initialDraft.artistMemory.displayName}</p>
                {initialDraft.artistMemory.translationPreferences.length > 0 ? (
                  <>
                    <p className="mt-3 text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(160,60,255,0.55)]">Preferences</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {initialDraft.artistMemory.translationPreferences.map((preference) => (
                        <span key={preference} className="rounded-full border border-[rgba(160,60,255,0.20)] bg-[rgba(160,60,255,0.08)] px-3 py-1 text-[11px] text-[#c87eff]">
                          {preference}
                        </span>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => { void handleGenerate(); }}
              disabled={isGenerating}
              className="w-full rounded-full bg-[linear-gradient(135deg,#a03cff,#ff1464)] py-3.5 text-[14px] font-bold text-white shadow-[0_0_24px_rgba(160,60,255,0.35)] transition hover:opacity-90 hover:shadow-[0_0_40px_rgba(160,60,255,0.55)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isGenerating ? "Generating draft..." : "Generate Draft"}
            </button>

            {draftLines.length > 0 ? (
              <a
                href={`/library/track/${track.spotifyTrackId}/review`}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-full border border-[rgba(255,20,100,0.25)] bg-[rgba(255,20,100,0.08)] py-3.5 text-[14px] font-bold text-[#ff6aaa] transition hover:bg-[rgba(255,20,100,0.16)] hover:shadow-[0_0_20px_rgba(255,20,100,0.25)]"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                Review Lyrics
              </a>
            ) : null}
          </div>
        ) : (
          <div className="mt-5 rounded-[14px] border border-[rgba(255,160,30,0.20)] bg-[rgba(255,160,30,0.08)] p-4 text-[13px] leading-[1.65] text-[#ffc87a]">
            {aiConfigured
              ? "Lafz needs readable original lyrics before it can generate a draft."
              : "Lafz could not initialize the AI provider yet."}
          </div>
        )}
      </section>

    </div>
  );
}
