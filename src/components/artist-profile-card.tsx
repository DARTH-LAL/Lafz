"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { AiGlossaryEntry } from "@/features/ai/glossary";

type CanonicalRendering = { term: string; rendering: string; note?: string };

type ArtistProfileResponse = {
  success: boolean;
  artistKey: string;
  displayName: string;
  updatedAt: string;
  builtFromSongs?: number;
  builtFromGlossaryTerms?: number;
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
  canonicalRenderings?: CanonicalRendering[];
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

// ── Collapsible section wrapper ────────────────────────────────────────────

function CollapsibleSection({
  label,
  hint,
  value,
  onChange,
  defaultOpen = false,
  fullWidth = false,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  defaultOpen?: boolean;
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const lineCount = value.trim() ? textToLines(value).length : 0;
  const preview = value.trim() ? textToLines(value)[0] : null;

  return (
    <div className={fullWidth ? "md:col-span-2" : ""}>
      {/* Header row — click to toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group mb-1.5 flex w-full items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-bold uppercase tracking-[1.5px] text-[rgba(255,20,100,0.62)]">
            {label}
          </span>
          {!open && lineCount > 0 && (
            <span className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2 py-0.5 text-[9px] text-[rgba(255,255,255,0.35)]">
              {lineCount}
            </span>
          )}
          {!open && preview && (
            <span className="truncate text-[10px] text-[rgba(255,255,255,0.25)] max-w-[200px]">
              {preview}
            </span>
          )}
        </div>
        <svg
          viewBox="0 0 16 16"
          className={`h-3 w-3 shrink-0 fill-[rgba(255,20,100,0.45)] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="M4.427 6.427a.75.75 0 0 1 1.06 0L8 8.94l2.513-2.513a.75.75 0 0 1 1.06 1.06l-3.043 3.044a.75.75 0 0 1-1.06 0L4.427 7.487a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </button>

      {open && (
        <div>
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={4}
            className="min-h-[110px] w-full rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3 text-[13px] leading-[1.6] text-white outline-none transition focus:border-[rgba(255,20,100,0.30)]"
          />
          <p className="mt-1.5 text-[11px] leading-[1.5] text-[rgba(255,255,255,0.30)]">{hint}</p>
        </div>
      )}
    </div>
  );
}

// ── Persona field (always visible, not collapsible) ────────────────────────

function PersonaField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="md:col-span-2">
      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-[1.5px] text-[rgba(255,20,100,0.62)]">
        Persona summary
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="min-h-[110px] w-full rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-4 py-3 text-[13px] leading-[1.6] text-white outline-none transition focus:border-[rgba(255,20,100,0.30)]"
      />
      <p className="mt-1.5 text-[11px] leading-[1.5] text-[rgba(255,255,255,0.30)]">
        One tight paragraph on how this artist usually speaks, postures, and frames themselves.
      </p>
    </div>
  );
}

// ── Main card ─────────────────────────────────────────────────────────────

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
  const [canonicalRenderings, setCanonicalRenderings] = useState<CanonicalRendering[]>([]);
  const [newRendering, setNewRendering] = useState<{ term: string; rendering: string; note: string }>({ term: "", rendering: "", note: "" });
  const [showRenderingForm, setShowRenderingForm] = useState(false);
  const [glossaryEntries, setGlossaryEntries] = useState<AiGlossaryEntry[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [builtFromSongs, setBuiltFromSongs] = useState<number | null>(null);
  const [builtFromGlossaryTerms, setBuiltFromGlossaryTerms] = useState<number | null>(null);

  const fetchProfile = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = refresh
        ? `/api/artist-profile/${artistKey}?refresh=true`
        : `/api/artist-profile/${artistKey}`;
      const response = await fetch(url);
      const payload = (await response.json()) as ArtistProfileResponse & { error?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Failed to load artist profile.");
      }
      setForm(buildFormState(payload));
      setCanonicalRenderings(payload.canonicalRenderings ?? []);
      setGlossaryEntries(payload.glossaryEntries ?? []);
      setUpdatedAt(payload.updatedAt);
      setBuiltFromSongs(payload.builtFromSongs ?? null);
      setBuiltFromGlossaryTerms(payload.builtFromGlossaryTerms ?? null);
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
    if (!form) return;
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
          notes: textToLines(form.notes),
          canonicalRenderings
        })
      });
      const payload = (await response.json()) as ArtistProfileResponse & { error?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.error ?? "Failed to save artist profile.");
      }
      setForm(buildFormState(payload));
      setCanonicalRenderings(payload.canonicalRenderings ?? []);
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
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-[#ff1464] shadow-[0_0_10px_rgba(255,20,100,0.8)]" />
          <p className="text-[11px] font-bold uppercase tracking-[2.2px] text-[rgba(255,20,100,0.65)]">Artist profile</p>
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

      {/* Built-from summary bar */}
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-[14px] border border-[rgba(255,20,100,0.12)] bg-[rgba(255,20,100,0.04)] px-4 py-3">
        {builtFromSongs !== null ? (
          <span className="flex items-center gap-1.5 text-[11px] text-[rgba(255,255,255,0.55)]">
            <span className="text-[#ff6aaa]">🎵</span>
            <span>Built from <strong className="text-white">{builtFromSongs}</strong> song{builtFromSongs !== 1 ? "s" : ""}</span>
          </span>
        ) : null}
        {builtFromSongs !== null && (builtFromGlossaryTerms !== null || glossaryEntries.length > 0) ? (
          <span className="text-[rgba(255,255,255,0.18)]">·</span>
        ) : null}
        <span className="flex items-center gap-1.5 text-[11px] text-[rgba(255,255,255,0.55)]">
          <span className="text-[#ff6aaa]">📖</span>
          <span><strong className="text-white">{builtFromGlossaryTerms ?? glossaryEntries.length}</strong> glossary term{(builtFromGlossaryTerms ?? glossaryEntries.length) !== 1 ? "s" : ""}</span>
        </span>
        {updatedAt ? (
          <>
            <span className="text-[rgba(255,255,255,0.18)]">·</span>
            <span className="text-[11px] text-[rgba(255,255,255,0.30)]">
              Updated {new Date(updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </span>
          </>
        ) : null}
        {/* Glossary term previews */}
        {glossaryPreview.length > 0 ? (
          <div className="mt-2 w-full flex flex-wrap gap-1.5">
            {glossaryPreview.map((entry) => (
              <span
                key={`${entry.term}-${entry.meaning}`}
                className="rounded-full border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.03)] px-2.5 py-0.5 text-[10px] text-[rgba(255,255,255,0.55)]"
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
        <div className="grid gap-3 md:grid-cols-2">
          {/* Persona — always expanded, full width */}
          <PersonaField value={form.personaSummary} onChange={(v) => setField("personaSummary", v)} />

          {/* High-impact fields — open by default */}
          <CollapsibleSection
            label="Translation preferences"
            hint="One item per line. Example: keep swagger sharp, avoid softening threats."
            value={form.translationPreferences}
            onChange={(v) => setField("translationPreferences", v)}
            defaultOpen
          />
          <CollapsibleSection
            label="Translation directives"
            hint="Hard rules Lafz should remember. One item per line."
            value={form.translationDirectives}
            onChange={(v) => setField("translationDirectives", v)}
            defaultOpen
          />

          {/* Context fields — collapsed by default */}
          <CollapsibleSection
            label="Recurring themes"
            hint="What this artist keeps returning to. One item per line."
            value={form.recurringThemes}
            onChange={(v) => setField("recurringThemes", v)}
          />
          <CollapsibleSection
            label="Recurring motifs"
            hint="Images or motifs like status, loyalty, pain, dominance, romance."
            value={form.recurringMotifs}
            onChange={(v) => setField("recurringMotifs", v)}
          />
          <CollapsibleSection
            label="Relationship patterns"
            hint="How the artist talks to lovers, rivals, friends, or enemies."
            value={form.relationshipPatterns}
            onChange={(v) => setField("relationshipPatterns", v)}
          />
          <CollapsibleSection
            label="Tone notes"
            hint="Mood and tone descriptors. One item per line."
            value={form.toneNotes}
            onChange={(v) => setField("toneNotes", v)}
          />
          <CollapsibleSection
            label="Voice notes"
            hint="How the voice should sound in English: cold, proud, teasing, wounded, commanding."
            value={form.voiceNotes}
            onChange={(v) => setField("voiceNotes", v)}
          />
          <CollapsibleSection
            label="Stance notes"
            hint="Typical social posture: dominant, defensive, playful, self-assured, etc."
            value={form.stanceNotes}
            onChange={(v) => setField("stanceNotes", v)}
          />
          <CollapsibleSection
            label="Perspective notes"
            hint="Who is usually speaking, to whom, and from what point of view."
            value={form.perspectiveNotes}
            onChange={(v) => setField("perspectiveNotes", v)}
          />
          <CollapsibleSection
            label="General notes"
            hint="Anything else that helps Lafz stay true to the artist."
            value={form.notes}
            onChange={(v) => setField("notes", v)}
          />

          {/* Canonical renderings — full width, always visible */}
          <div className="md:col-span-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[1.5px] text-[rgba(255,20,100,0.62)]">
                  Canonical renderings
                </span>
                <span className="rounded-full border border-[rgba(255,20,100,0.18)] bg-[rgba(255,20,100,0.06)] px-2 py-0.5 text-[9px] font-bold text-[#ff6aaa]">
                  HARD RULES
                </span>
                {canonicalRenderings.length > 0 && (
                  <span className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-2 py-0.5 text-[9px] text-[rgba(255,255,255,0.35)]">
                    {canonicalRenderings.length}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowRenderingForm((v) => !v)}
                className="rounded-full border border-[rgba(255,20,100,0.22)] bg-[rgba(255,20,100,0.07)] px-3 py-1 text-[10px] font-semibold text-[#ff6aaa] transition hover:bg-[rgba(255,20,100,0.14)]"
              >
                {showRenderingForm ? "✕ Cancel" : "+ Add"}
              </button>
            </div>
            <p className="mb-2 text-[11px] leading-[1.5] text-[rgba(255,255,255,0.30)]">
              Terms the AI must always translate exactly as specified — e.g. &quot;jatt&quot; → &quot;jatt&quot;, &quot;sandh&quot; → &quot;bull&quot;.
            </p>

            {showRenderingForm && (
              <div className="mb-3 grid grid-cols-[1fr_1fr_auto] gap-2 rounded-[14px] border border-[rgba(255,20,100,0.18)] bg-[rgba(255,20,100,0.04)] p-3">
                <input
                  value={newRendering.term}
                  onChange={(e) => setNewRendering((r) => ({ ...r, term: e.target.value }))}
                  placeholder="Source term"
                  className="rounded-[10px] border border-[rgba(255,20,100,0.22)] bg-[rgba(255,20,100,0.06)] px-3 py-2 text-[12px] text-white outline-none placeholder:text-[rgba(255,255,255,0.3)] focus:border-[rgba(255,20,100,0.5)]"
                />
                <input
                  value={newRendering.rendering}
                  onChange={(e) => setNewRendering((r) => ({ ...r, rendering: e.target.value }))}
                  placeholder="Always render as…"
                  className="rounded-[10px] border border-[rgba(255,20,100,0.22)] bg-[rgba(255,20,100,0.06)] px-3 py-2 text-[12px] text-white outline-none placeholder:text-[rgba(255,255,255,0.3)] focus:border-[rgba(255,20,100,0.5)]"
                />
                <button
                  type="button"
                  onClick={() => {
                    const t = newRendering.term.trim();
                    const r = newRendering.rendering.trim();
                    if (!t || !r) return;
                    setCanonicalRenderings((prev) => {
                      if (prev.some((x) => x.term.toLowerCase() === t.toLowerCase())) return prev;
                      return [...prev, { term: t, rendering: r, ...(newRendering.note.trim() ? { note: newRendering.note.trim() } : {}) }];
                    });
                    setNewRendering({ term: "", rendering: "", note: "" });
                    setShowRenderingForm(false);
                  }}
                  className="rounded-[10px] bg-[linear-gradient(135deg,#ff1464,#ff6aaa)] px-4 py-2 text-[11px] font-bold text-white shadow-[0_0_12px_rgba(255,20,100,0.30)] hover:opacity-90"
                >
                  Add
                </button>
              </div>
            )}

            {canonicalRenderings.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {canonicalRenderings.map((r) => (
                  <div
                    key={r.term}
                    className="group flex items-center gap-1.5 rounded-full border border-[rgba(255,20,100,0.20)] bg-[rgba(255,20,100,0.06)] pl-3 pr-1.5 py-1"
                  >
                    <span className="text-[12px] font-semibold text-white">{r.term}</span>
                    <span className="text-[rgba(255,255,255,0.35)]">→</span>
                    <span className="text-[12px] text-[#ff6aaa]">{r.rendering}</span>
                    <button
                      type="button"
                      onClick={() => setCanonicalRenderings((prev) => prev.filter((x) => x.term !== r.term))}
                      className="ml-1 rounded-full p-0.5 text-[rgba(255,20,100,0.4)] transition hover:bg-[rgba(255,20,100,0.15)] hover:text-[#ff1464]"
                      title="Remove"
                    >
                      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-current"><path d="M1.5 1.5 8.5 8.5M8.5 1.5 1.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-[rgba(255,255,255,0.2)]">No canonical renderings yet. Add terms the AI must always translate the same way.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
