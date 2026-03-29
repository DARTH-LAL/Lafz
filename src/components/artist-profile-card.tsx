"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { AiGlossaryEntry } from "@/features/ai/glossary";

type ArtistProfileResponse = {
  success: boolean;
  artistKey: string;
  displayName: string;
  updatedAt: string;
  personaSummary: string | null;
  translationPreferences: string[];
  translationDirectives: string[];
  recurringThemes: string[];
  recurringMotifs: string[];
  relationshipPatterns: string[];
  toneNotes: string[];
  voiceNotes: string[];
  stanceNotes: string[];
  perspectiveNotes: string[];
  notes: string[];
  glossaryEntries: AiGlossaryEntry[];
};

type ProfileFormState = {
  displayName: string;
  personaSummary: string;
  translationPreferences: string;
  translationDirectives: string;
  recurringThemes: string;
  recurringMotifs: string;
  relationshipPatterns: string;
  toneNotes: string;
  voiceNotes: string;
  stanceNotes: string;
  perspectiveNotes: string;
  notes: string;
};

function linesToText(lines: string[]) {
  return lines.join("\n");
}

function textToLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildFormState(payload: ArtistProfileResponse): ProfileFormState {
  return {
    displayName: payload.displayName,
    personaSummary: payload.personaSummary ?? "",
    translationPreferences: linesToText(payload.translationPreferences),
    translationDirectives: linesToText(payload.translationDirectives),
    recurringThemes: linesToText(payload.recurringThemes),
    recurringMotifs: linesToText(payload.recurringMotifs),
    relationshipPatterns: linesToText(payload.relationshipPatterns),
    toneNotes: linesToText(payload.toneNotes),
    voiceNotes: linesToText(payload.voiceNotes),
    stanceNotes: linesToText(payload.stanceNotes),
    perspectiveNotes: linesToText(payload.perspectiveNotes),
    notes: linesToText(payload.notes)
  };
}

function Field({
  label,
  hint,
  value,
  onChange,
  multiline = true
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[1.5px] text-[rgba(255,20,100,0.62)]">
        {label}
      </label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={4}
          className="min-h-[110px] w-full rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3 text-[13px] leading-[1.6] text-white outline-none transition focus:border-[rgba(255,20,100,0.30)]"
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3 text-[13px] text-white outline-none transition focus:border-[rgba(255,20,100,0.30)]"
        />
      )}
      <p className="mt-1.5 text-[11px] leading-[1.5] text-[rgba(255,255,255,0.30)]">{hint}</p>
    </div>
  );
}

export function ArtistProfileCard({
  artistKey,
  artistName,
  fullPageHref
}: {
  artistKey: string;
  artistName: string;
  fullPageHref?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileFormState | null>(null);
  const [glossaryEntries, setGlossaryEntries] = useState<AiGlossaryEntry[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const fetchProfile = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = refresh ? `/api/artist-profile/${artistKey}?refresh=true` : `/api/artist-profile/${artistKey}`;
      const response = await fetch(url);
      const payload = (await response.json()) as ArtistProfileResponse & { error?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Failed to load artist profile.");
      }

      setForm(buildFormState(payload));
      setGlossaryEntries(payload.glossaryEntries ?? []);
      setUpdatedAt(payload.updatedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load artist profile.");
    } finally {
      setLoading(false);
    }
  }, [artistKey]);

  async function handleRegenerate() {
    setRegenerating(true);
    setError(null);
    setSuccess(null);
    try {
      await fetchProfile(true);
      setSuccess("Profile regenerated from latest glossary and song evidence.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate profile.");
    } finally {
      setRegenerating(false);
    }
  }

  useEffect(() => {
    void fetchProfile(false);
  }, [fetchProfile]);

  const glossaryPreview = useMemo(() => glossaryEntries.slice(0, 8), [glossaryEntries]);

  function setField(field: keyof ProfileFormState, value: string) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  }

  async function handleSave() {
    if (!form) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/artist-profile/${artistKey}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: form.displayName.trim() || artistName,
          personaSummary: form.personaSummary,
          translationPreferences: textToLines(form.translationPreferences),
          translationDirectives: textToLines(form.translationDirectives),
          recurringThemes: textToLines(form.recurringThemes),
          recurringMotifs: textToLines(form.recurringMotifs),
          relationshipPatterns: textToLines(form.relationshipPatterns),
          toneNotes: textToLines(form.toneNotes),
          voiceNotes: textToLines(form.voiceNotes),
          stanceNotes: textToLines(form.stanceNotes),
          perspectiveNotes: textToLines(form.perspectiveNotes),
          notes: textToLines(form.notes)
        })
      });

      const payload = (await response.json()) as ArtistProfileResponse & { error?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Failed to save artist profile.");
      }

      setForm(buildFormState(payload));
      setGlossaryEntries(payload.glossaryEntries ?? []);
      setUpdatedAt(payload.updatedAt);
      setSuccess("Artist profile saved. Lafz will use it in future translation passes.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save artist profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-[#ff1464] shadow-[0_0_10px_rgba(255,20,100,0.8)]" />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[2.2px] text-[rgba(255,20,100,0.65)]">Artist profile</p>
            <p className="mt-1 text-[13px] text-[rgba(255,255,255,0.42)]">
              Lafz auto-builds this from the artist&apos;s songs, glossary, and corrections so perspective survives translation.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {fullPageHref ? (
            <a
              href={fullPageHref}
              className="rounded-full border border-[rgba(255,255,255,0.10)] px-3 py-1.5 text-[11px] font-semibold text-[rgba(255,255,255,0.45)] transition hover:border-[rgba(255,20,100,0.22)] hover:text-[#ff6aaa]"
            >
              Full page
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => { void handleRegenerate(); }}
            disabled={loading || regenerating}
            title="Rebuild this profile from the latest glossary and song evidence"
            className="rounded-full border border-[rgba(255,20,100,0.25)] bg-[rgba(255,20,100,0.07)] px-4 py-2 text-[11px] font-semibold text-[#ff6aaa] transition hover:bg-[rgba(255,20,100,0.14)] disabled:opacity-40"
          >
            {regenerating ? (
              <span className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-[#ff6aaa] border-t-transparent" />
                Regenerating…
              </span>
            ) : "↺ Regenerate"}
          </button>
          <button
            type="button"
            onClick={() => { void handleSave(); }}
            disabled={loading || saving || !form}
            className="rounded-full bg-[linear-gradient(135deg,#ff1464,#ff6aaa)] px-4 py-2 text-[11px] font-bold text-white shadow-[0_0_18px_rgba(255,20,100,0.30)] transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </div>

      <div className="mb-5 rounded-[18px] border border-[rgba(255,20,100,0.12)] bg-[rgba(255,20,100,0.04)] p-4">
        <p className="text-[12px] leading-[1.6] text-white">
          Artist glossary is now part of artist memory. Lafz loads those glossary terms into the profile automatically during
          translation, and this profile is auto-bootstrapped the first time there&apos;s enough evidence.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-[rgba(255,20,100,0.18)] bg-[rgba(255,20,100,0.08)] px-3 py-1 text-[10px] font-bold uppercase tracking-[1.2px] text-[#ff6aaa]">
            {glossaryEntries.length} glossary term{glossaryEntries.length === 1 ? "" : "s"}
          </span>
          {updatedAt ? (
            <span className="text-[11px] text-[rgba(255,255,255,0.35)]">Updated {new Date(updatedAt).toLocaleString()}</span>
          ) : null}
        </div>
        {glossaryPreview.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {glossaryPreview.map((entry) => (
              <span
                key={`${entry.term}-${entry.meaning}`}
                className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-1 text-[11px] text-[rgba(255,255,255,0.72)]"
              >
                {entry.term} → {entry.meaning}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {error ? <p className="mb-3 text-[12px] text-[#ff8e9f]">{error}</p> : null}
      {success ? <p className="mb-3 text-[12px] text-[#ff8bd3]">{success}</p> : null}

      {loading || !form ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="h-[140px] animate-pulse rounded-[18px] bg-[rgba(255,255,255,0.04)]" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Field
              label="Persona summary"
              hint="One tight paragraph on how this artist usually speaks, postures, and frames themselves."
              value={form.personaSummary}
              onChange={(value) => setField("personaSummary", value)}
            />
          </div>
          <Field
            label="Translation preferences"
            hint="One item per line. Example: keep swagger sharp, avoid softening threats."
            value={form.translationPreferences}
            onChange={(value) => setField("translationPreferences", value)}
          />
          <Field
            label="Translation directives"
            hint="Hard rules Lafz should remember. One item per line."
            value={form.translationDirectives}
            onChange={(value) => setField("translationDirectives", value)}
          />
          <Field
            label="Recurring themes"
            hint="What this artist keeps returning to. One item per line."
            value={form.recurringThemes}
            onChange={(value) => setField("recurringThemes", value)}
          />
          <Field
            label="Recurring motifs"
            hint="Images or motifs like status, loyalty, pain, dominance, romance."
            value={form.recurringMotifs}
            onChange={(value) => setField("recurringMotifs", value)}
          />
          <Field
            label="Relationship patterns"
            hint="How the artist talks to lovers, rivals, friends, or enemies."
            value={form.relationshipPatterns}
            onChange={(value) => setField("relationshipPatterns", value)}
          />
          <Field
            label="Tone notes"
            hint="Mood and tone descriptors. One item per line."
            value={form.toneNotes}
            onChange={(value) => setField("toneNotes", value)}
          />
          <Field
            label="Voice notes"
            hint="How the voice should sound in English: cold, proud, teasing, wounded, commanding."
            value={form.voiceNotes}
            onChange={(value) => setField("voiceNotes", value)}
          />
          <Field
            label="Stance notes"
            hint="Typical social posture: dominant, defensive, playful, self-assured, etc."
            value={form.stanceNotes}
            onChange={(value) => setField("stanceNotes", value)}
          />
          <Field
            label="Perspective notes"
            hint="Who is usually speaking, to whom, and from what point of view."
            value={form.perspectiveNotes}
            onChange={(value) => setField("perspectiveNotes", value)}
          />
          <Field
            label="General notes"
            hint="Anything else that helps Lafz stay true to the artist."
            value={form.notes}
            onChange={(value) => setField("notes", value)}
          />
        </div>
      )}
    </div>
  );
}
