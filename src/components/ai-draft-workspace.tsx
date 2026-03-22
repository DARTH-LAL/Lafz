"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { AiProviderStatus, AiTranslationDraftFile, AiTranslationDraftInspection } from "@/features/ai/types";
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
  literal: string;
  natural: string;
  slangAware: string;
  chosen: string;
  transliteration: string | null;
  note: string | null;
  ambiguity: string | null;
  confidence: "low" | "medium" | "high";
  selectorReason: string | null;
};

function getAiProviderLabel(provider: AiProviderStatus["provider"]) {
  return provider === "openai" ? "OpenAI" : "Ollama";
}

function formatUpdatedAt(value: string | null) {
  if (!value) {
    return "Not updated yet";
  }

  return new Date(value).toLocaleString();
}

function toEditableDraftLine(line: AiTranslationDraftFile["lines"][number]): EditableDraftLine {
  return {
    order: line.order,
    original: line.original,
    literal: line.literal,
    natural: line.natural,
    slangAware: line.slangAware,
    chosen: line.chosen,
    transliteration: line.transliteration,
    note: line.note,
    ambiguity: line.ambiguity,
    confidence: line.confidence,
    selectorReason: line.selectorReason
  };
}

function getConfidenceClasses(confidence: EditableDraftLine["confidence"]) {
  if (confidence === "high") {
    return "border-[rgba(255,140,66,0.2)] bg-[rgba(255,140,66,0.1)] text-[#ffd9b8]";
  }

  if (confidence === "medium") {
    return "border-amber-300/20 bg-amber-300/10 text-amber-100";
  }

  return "border-rose-300/20 bg-rose-300/10 text-rose-100";
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
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [showLowConfidenceFirst, setShowLowConfidenceFirst] = useState(true);
  const [message, setMessage] = useState(initialMessage);
  const [messageTone, setMessageTone] = useState<"success" | "error">(initialStatus === "error" ? "error" : "success");
  const [draftLines, setDraftLines] = useState<EditableDraftLine[]>(() => (initialDraft ? initialDraft.lines.map(toEditableDraftLine) : []));

  const canGenerate = aiConfigured && (lyricsKind === "synced" || lyricsKind === "plain");
  const lowConfidenceCount = useMemo(() => draftLines.filter((line) => line.confidence === "low").length, [draftLines]);
  const displayedDraftLines = useMemo(() => {
    const lines = [...draftLines];

    if (!showLowConfidenceFirst) {
      return lines.sort((left, right) => left.order - right.order);
    }

    const confidenceWeight = (confidence: EditableDraftLine["confidence"]) => {
      if (confidence === "low") {
        return 0;
      }

      if (confidence === "medium") {
        return 1;
      }

      return 2;
    };

    return lines.sort((left, right) => {
      const confidenceDifference = confidenceWeight(left.confidence) - confidenceWeight(right.confidence);

      if (confidenceDifference !== 0) {
        return confidenceDifference;
      }

      return left.order - right.order;
    });
  }, [draftLines, showLowConfidenceFirst]);

  const updateDraftLine = (order: number, updater: (line: EditableDraftLine) => EditableDraftLine) => {
    setDraftLines((currentLines) =>
      currentLines.map((currentLine) => (currentLine.order === order ? updater(currentLine) : currentLine))
    );
  };

  useEffect(() => {
    setDraftLines(initialDraft ? initialDraft.lines.map(toEditableDraftLine) : []);
  }, [initialDraft?.generatedAt, initialDraft?.spotifyTrackId]);

  useEffect(() => {
    if (initialMessage) {
      setMessage(initialMessage);
      setMessageTone(initialStatus === "error" ? "error" : "success");
    }
  }, [initialMessage, initialStatus]);

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
      };

      if (!response.ok || !payload.success) {
        throw new Error(payload.detail ?? payload.message ?? "Could not generate the AI draft.");
      }

      setMessage(payload.message);
      setMessageTone("success");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not generate the AI draft.");
      setMessageTone("error");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveDraft = async () => {
    setIsSavingDraft(true);
    setMessage(null);

    try {
      const response = await fetch("/api/ai/save-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          spotifyTrackId: track.spotifyTrackId,
          lines: draftLines.map((line) => ({
            order: line.order,
            chosen: line.chosen,
            note: line.note,
            transliteration: line.transliteration
          }))
        })
      });

      const payload = (await response.json()) as {
        success?: boolean;
        message?: string;
        error?: string;
      };

      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Could not save the AI draft review changes.");
      }

      setMessage(payload.message ?? "Saved the draft review changes.");
      setMessageTone("success");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the AI draft review changes.");
      setMessageTone("error");
    } finally {
      setIsSavingDraft(false);
    }
  };

  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(320px,380px)_1fr] xl:items-start">
      <section className="rounded-[32px] border border-white/10 bg-[color:var(--lafz-panel-strong)] p-6 shadow-[0_24px_100px_rgba(0,0,0,0.3)] backdrop-blur-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#ff6ba8]/80">AI translation draft</p>
        <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-white">
          Generate a stronger translation draft.
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-300">
          Lafz now does song-level context detection, grouped first-pass translation, consistency refinement, and a
          final selector pass. You get literal, natural, and slang-aware candidates so the harder lines are easier to trust and refine.
        </p>

        {message ? (
          <div
            className={`mt-5 rounded-[22px] p-4 text-sm leading-7 ${
              messageTone === "error"
                ? "border border-amber-300/20 bg-amber-300/10 text-amber-100"
                : "border border-[rgba(255,45,120,0.2)] bg-[rgba(255,45,120,0.09)] text-[#fff0f6]"
            }`}
          >
            {message}
          </div>
        ) : null}

        <div className="mt-5 rounded-[22px] border border-white/8 bg-black/10 p-4 text-sm text-slate-300">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Current AI behavior</p>
          <p className="mt-2">
            {lyricsKind === "synced"
              ? "This track has synced original lyrics, so Lafz can generate a draft and automatically use those timings for playback."
              : lyricsKind === "plain"
                ? "This track only has plain original lyrics right now, so Lafz will save an untimed draft and keep playback in reading mode."
                : "Import local lyrics for this track first, then generate a draft from that cache."}
          </p>
        </div>

        <div className="mt-4 rounded-[22px] border border-white/8 bg-black/10 p-4 text-sm text-slate-300">
          <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Current AI provider</p>
          <p className="mt-2">
            Provider: <span className="text-slate-100">{getAiProviderLabel(aiProviderStatus.provider)}</span>
          </p>
          <p className="mt-2">
            Endpoint: <span className="font-mono text-xs text-slate-100">{aiProviderStatus.baseUrl}</span>
          </p>
          <p className="mt-2">
            Model: <span className="font-mono text-xs text-slate-100">{aiProviderStatus.model}</span>
          </p>
          <p className="mt-2">
            Status:{" "}
            <span className={aiProviderStatus.available ? "text-[#fff0f6]" : "text-amber-100"}>
              {aiProviderStatus.available ? "reachable" : "not reachable"}
            </span>
          </p>
          <p className="mt-2">
            Model ready:{" "}
            <span className={aiProviderStatus.modelAvailable ? "text-[#fff0f6]" : "text-amber-100"}>
              {aiProviderStatus.modelAvailable ? "yes" : "no"}
            </span>
          </p>
        </div>

        {canGenerate ? (
          <div className="mt-6 space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Source language</span>
                <input
                  type="text"
                  value={sourceLanguage}
                  onChange={(event) => {
                    setSourceLanguage(event.target.value);
                  }}
                  placeholder="Leave blank to auto-detect from lyrics"
                  className="mt-3 w-full rounded-[18px] border border-white/12 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#ff2d78]/50"
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Target language</span>
                <input
                  type="text"
                  value={targetLanguage}
                  onChange={(event) => {
                    setTargetLanguage(event.target.value);
                  }}
                  className="mt-3 w-full rounded-[18px] border border-white/12 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#ff2d78]/50"
                />
              </label>
            </div>

            <div className="space-y-3 rounded-[22px] border border-white/8 bg-black/10 p-4 text-sm text-slate-300">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={includeTransliteration}
                  onChange={(event) => {
                    setIncludeTransliteration(event.target.checked);
                  }}
                  className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent text-[#ff6ba8] focus:ring-[#ff2d78]/40"
                />
                <span>Include transliteration when it helps.</span>
              </label>

              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={includeNotes}
                  onChange={(event) => {
                    setIncludeNotes(event.target.checked);
                  }}
                  className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent text-[#ff6ba8] focus:ring-[#ff2d78]/40"
                />
                <span>Include slang and cultural notes when needed.</span>
              </label>

              {(translationKind === "translated" || translationKind === "malformed") && lyricsKind === "synced" ? (
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={overwriteExistingTranslation}
                    onChange={(event) => {
                      setOverwriteExistingTranslation(event.target.checked);
                    }}
                    className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent text-[#ff6ba8] focus:ring-[#ff2d78]/40"
                  />
                  <span>Replace the current synced translation file for this track.</span>
                </label>
              ) : null}
            </div>

            <div className="rounded-[22px] border border-white/8 bg-black/10 p-4 text-sm text-slate-300">
              <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Active model</p>
              <p className="mt-2 font-mono text-xs text-slate-100">{aiModel}</p>
              <p className="mt-3 text-xs leading-6 text-slate-400">
                Lafz now stores literal, natural, and slang-aware alternatives per line, then runs a selector pass to
                choose the safest final default for playback.
              </p>
            </div>

            {initialDraft?.songContext ? (
              <div className="rounded-[22px] border border-white/8 bg-black/10 p-4 text-sm text-slate-300">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Song context</p>
                <p className="mt-3 text-slate-100">{initialDraft.songContext.summary}</p>
                <p className="mt-3 text-xs uppercase tracking-[0.22em] text-slate-500">Tone</p>
                <p className="mt-2 text-slate-200">{initialDraft.songContext.tone}</p>
                {initialDraft.songContext.themes.length > 0 ? (
                  <>
                    <p className="mt-3 text-xs uppercase tracking-[0.22em] text-slate-500">Themes</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {initialDraft.songContext.themes.map((theme) => (
                        <span key={theme} className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-slate-200">
                          {theme}
                        </span>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {initialDraft?.artistMemory ? (
              <div className="rounded-[22px] border border-white/8 bg-black/10 p-4 text-sm text-slate-300">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Artist memory</p>
                <p className="mt-3 text-slate-100">{initialDraft.artistMemory.displayName}</p>
                {initialDraft.artistMemory.translationPreferences.length > 0 ? (
                  <>
                    <p className="mt-3 text-xs uppercase tracking-[0.22em] text-slate-500">Preferences</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {initialDraft.artistMemory.translationPreferences.map((preference) => (
                        <span key={preference} className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-slate-200">
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
              onClick={() => {
                void handleGenerate();
              }}
              disabled={isGenerating}
              className="inline-flex w-full items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff2d78_0%,#ff8c42_100%)] px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isGenerating ? "Generating draft..." : "Generate AI draft"}
            </button>
          </div>
        ) : (
          <div className="mt-6 rounded-[22px] border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-7 text-amber-100">
            {aiConfigured
              ? "Lafz needs readable original lyrics before it can generate a draft."
              : "Lafz could not initialize the AI provider yet."}
          </div>
        )}
      </section>

      <section className="rounded-[32px] border border-white/10 bg-[color:var(--lafz-panel)] p-6 shadow-[0_24px_100px_rgba(0,0,0,0.3)] backdrop-blur-xl">
        <div className="flex flex-col gap-4 border-b border-white/8 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-[#ff6ba8]/80">Draft review</p>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-white">
              Review only the uncertain lines.
            </h2>
            <p className="mt-2 text-base text-slate-400">
              Lafz keeps literal, natural, and slang-aware versions side by side, then bubbles low-confidence lines to the top so you can fix the risky ones first. Saving your edits also teaches Lafz track-level and artist-level preferred renderings for future drafts and re-runs the remaining lines with your corrected context.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.24em] text-slate-400">
            <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2">
              {draftLines.length} draft lines
            </span>
            <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2">
              {lowConfidenceCount} low confidence
            </span>
            <button
              type="button"
              onClick={() => {
                setShowLowConfidenceFirst((currentValue) => !currentValue);
              }}
              className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-slate-200 transition hover:bg-white/[0.1]"
            >
              {showLowConfidenceFirst ? "Low confidence first" : "Original order"}
            </button>
          </div>
        </div>

        {initialInspection.exists ? (
          <div className="mt-5 rounded-[22px] border border-dashed border-white/12 bg-black/10 p-4 text-sm text-slate-300">
            <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Local draft path</p>
            <p className="mt-2 break-all font-mono text-xs text-slate-200">{initialInspection.filePath}</p>
            <p className="mt-3 text-xs uppercase tracking-[0.22em] text-slate-500">Last modified</p>
            <p className="mt-2 text-slate-200">{formatUpdatedAt(initialInspection.lastModifiedAt)}</p>
          </div>
        ) : null}

        {draftLines.length > 0 ? (
          <>
            <div className="mt-6 space-y-4">
              {displayedDraftLines.map((line) => (
                <article key={`${track.spotifyTrackId}-${line.order}`} className="rounded-[24px] border border-white/8 bg-black/10 p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Line {line.order + 1}</p>
                      <p className="mt-2 text-lg text-white">{line.original}</p>
                    </div>
                    <span className={`inline-flex rounded-full border px-3 py-2 text-xs font-semibold uppercase tracking-[0.22em] ${getConfidenceClasses(line.confidence)}`}>
                      {line.confidence} confidence
                    </span>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Literal</p>
                      <p className="mt-2 text-sm leading-7 text-slate-200">{line.literal}</p>
                      <button
                        type="button"
                        onClick={() => {
                          updateDraftLine(line.order, (currentLine) => ({ ...currentLine, chosen: currentLine.literal }));
                        }}
                        className="mt-4 inline-flex items-center justify-center rounded-full border border-white/12 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-white/10"
                      >
                        Use literal
                      </button>
                    </div>

                    <div className="rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Natural</p>
                      <p className="mt-2 text-sm leading-7 text-slate-200">{line.natural}</p>
                      <button
                        type="button"
                        onClick={() => {
                          updateDraftLine(line.order, (currentLine) => ({ ...currentLine, chosen: currentLine.natural }));
                        }}
                        className="mt-4 inline-flex items-center justify-center rounded-full border border-[rgba(255,45,120,0.2)] bg-[rgba(255,45,120,0.09)] px-4 py-2 text-xs font-semibold text-[#fff0f6] transition hover:bg-[rgba(255,45,120,0.14)]"
                      >
                        Use natural
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 rounded-[20px] border border-white/8 bg-white/[0.03] p-4">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Slang-aware</p>
                    <p className="mt-2 text-sm leading-7 text-slate-200">{line.slangAware}</p>
                    <button
                      type="button"
                      onClick={() => {
                        updateDraftLine(line.order, (currentLine) => ({ ...currentLine, chosen: currentLine.slangAware }));
                      }}
                      className="mt-4 inline-flex items-center justify-center rounded-full border border-fuchsia-300/20 bg-fuchsia-300/10 px-4 py-2 text-xs font-semibold text-fuchsia-100 transition hover:bg-fuchsia-300/15"
                    >
                      Use slang-aware
                    </button>
                  </div>

                  <label className="mt-4 block">
                    <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Chosen line</span>
                    <textarea
                      value={line.chosen}
                      rows={2}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        updateDraftLine(line.order, (currentLine) => ({ ...currentLine, chosen: nextValue }));
                      }}
                      className="mt-3 w-full rounded-[18px] border border-white/12 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#ff2d78]/50"
                    />
                  </label>

                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Transliteration</span>
                      <input
                        type="text"
                        value={line.transliteration ?? ""}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          updateDraftLine(line.order, (currentLine) => ({
                            ...currentLine,
                            transliteration: nextValue || null
                          }));
                        }}
                        className="mt-3 w-full rounded-[18px] border border-white/12 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#ff2d78]/50"
                      />
                    </label>

                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Note</span>
                      <textarea
                        value={line.note ?? ""}
                        rows={2}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          updateDraftLine(line.order, (currentLine) => ({ ...currentLine, note: nextValue || null }));
                        }}
                        className="mt-3 w-full rounded-[18px] border border-white/12 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#ff2d78]/50"
                      />
                    </label>
                  </div>

                  {line.selectorReason ? (
                    <div className="mt-4 rounded-[20px] border border-[rgba(255,45,120,0.2)] bg-[rgba(255,45,120,0.09)] p-4 text-sm leading-7 text-[#fff0f6]">
                      <p className="text-xs uppercase tracking-[0.22em] text-[#ffb3d0]/80">Selector reason</p>
                      <p className="mt-2">{line.selectorReason}</p>
                    </div>
                  ) : null}

                  {line.ambiguity ? (
                    <div className="mt-4 rounded-[20px] border border-amber-300/20 bg-amber-300/10 p-4 text-sm leading-7 text-amber-100">
                      <p className="text-xs uppercase tracking-[0.22em] text-amber-200/80">Ambiguity</p>
                      <p className="mt-2">{line.ambiguity}</p>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  void handleSaveDraft();
                }}
                disabled={isSavingDraft}
                className="inline-flex items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff2d78_0%,#ff8c42_100%)] px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSavingDraft ? "Saving draft..." : "Save draft review"}
              </button>
            </div>
          </>
        ) : (
          <div className="mt-5 rounded-[22px] border border-white/8 bg-white/[0.03] p-5 text-base leading-7 text-slate-300">
            Generate a draft first, then Lafz will show the stronger review view here instead of only raw JSON.
          </div>
        )}
      </section>
    </div>
  );
}
