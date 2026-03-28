"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { AiGlossaryEntry } from "@/features/ai/glossary";
import type { PendingGlossarySuggestion } from "@/features/ai/glossary-repository";

// ── Types ─────────────────────────────────────────────────────────────────

type GlossaryApiResponse = {
  success: boolean;
  displayName: string;
  entries: AiGlossaryEntry[];
};

type SuggestionsApiResponse = {
  success: boolean;
  suggestions: PendingGlossarySuggestion[];
};

// ── Category badge ─────────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<string, { label: string; color: string }> = {
  preferred_rendering: { label: "Preferred", color: "border-[rgba(255,20,100,0.25)] bg-[rgba(255,20,100,0.08)] text-[#ff6aaa]" },
  slang:              { label: "Slang",     color: "border-[rgba(162,89,255,0.25)] bg-[rgba(162,89,255,0.08)] text-[#c87eff]" },
  idiom:              { label: "Idiom",     color: "border-[rgba(64,232,255,0.20)] bg-[rgba(64,232,255,0.07)] text-[#40e8ff]" },
  phrase:             { label: "Phrase",    color: "border-[rgba(63,255,170,0.20)] bg-[rgba(63,255,170,0.07)] text-[#3fffaa]" },
  reference:          { label: "Ref",       color: "border-[rgba(255,200,80,0.22)] bg-[rgba(255,200,80,0.07)] text-[#ffc850]" },
  entry:              { label: "Term",      color: "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.55)]" },
};

function CategoryBadge({ category }: { category?: string }) {
  const style = CATEGORY_STYLES[category ?? "entry"] ?? CATEGORY_STYLES["entry"];
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[1.2px] ${style.color}`}>
      {style.label}
    </span>
  );
}

// ── Add / Edit form ────────────────────────────────────────────────────────

const CATEGORIES = ["preferred_rendering", "slang", "idiom", "phrase", "reference", "entry"] as const;

type FormState = {
  term: string;
  meaning: string;
  note: string;
  category: string;
};

const EMPTY_FORM: FormState = { term: "", meaning: "", note: "", category: "preferred_rendering" };

function GlossaryForm({
  initial,
  artistName,
  artistKey,
  onSaved,
  onCancel,
}: {
  initial?: Partial<FormState>;
  artistName: string;
  artistKey: string;
  onSaved: (entry: AiGlossaryEntry) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, ...initial });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const termRef = useRef<HTMLInputElement>(null);

  useEffect(() => { termRef.current?.focus(); }, []);

  function set(field: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.term.trim() || !form.meaning.trim()) {
      setError("Term and meaning are both required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const entry: AiGlossaryEntry = {
        term: form.term.trim(),
        meaning: form.meaning.trim(),
        category: form.category as AiGlossaryEntry["category"],
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      };
      const res = await fetch(`/api/glossary/artist/${artistKey}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: artistName, entry }),
      });
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? "Save failed");
      onSaved(entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} className="mt-3 rounded-[14px] border border-[rgba(255,20,100,0.18)] bg-[rgba(255,20,100,0.04)] p-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-[1.2px] text-[rgba(255,20,100,0.6)]">Term</label>
          <input
            ref={termRef}
            value={form.term}
            onChange={(e) => set("term", e.target.value)}
            placeholder="e.g. kataar"
            className="w-full rounded-[10px] border border-[rgba(255,20,100,0.22)] bg-[rgba(255,20,100,0.06)] px-3 py-2 text-[13px] text-white outline-none transition focus:border-[rgba(255,20,100,0.5)] placeholder:text-[#5a4870]"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-[1.2px] text-[rgba(255,20,100,0.6)]">Meaning</label>
          <input
            value={form.meaning}
            onChange={(e) => set("meaning", e.target.value)}
            placeholder="e.g. queue of people"
            className="w-full rounded-[10px] border border-[rgba(255,20,100,0.22)] bg-[rgba(255,20,100,0.06)] px-3 py-2 text-[13px] text-white outline-none transition focus:border-[rgba(255,20,100,0.5)] placeholder:text-[#5a4870]"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-[1.2px] text-[rgba(255,20,100,0.6)]">Category</label>
          <select
            value={form.category}
            onChange={(e) => set("category", e.target.value)}
            className="w-full rounded-[10px] border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-[13px] text-white outline-none transition focus:border-[rgba(255,20,100,0.35)]"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_STYLES[c]?.label ?? c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-[1.2px] text-[rgba(255,20,100,0.6)]">Note <span className="font-normal opacity-50">(optional)</span></label>
          <input
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder="Context or usage note"
            className="w-full rounded-[10px] border border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-[13px] text-white outline-none transition focus:border-[rgba(255,20,100,0.35)] placeholder:text-[#5a4870]"
          />
        </div>
      </div>
      {error && <p className="mt-2 text-[11px] text-[#ff6aaa]">{error}</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-full border border-[rgba(255,255,255,0.10)] px-4 py-1.5 text-[11px] text-[rgba(255,255,255,0.4)] transition hover:text-white disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-[linear-gradient(135deg,#ff1464,#ff6aaa)] px-5 py-1.5 text-[12px] font-bold text-white shadow-[0_0_14px_rgba(255,20,100,0.35)] transition hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save term"}
        </button>
      </div>
    </form>
  );
}

// ── Suggestion row ─────────────────────────────────────────────────────────

function SuggestionRow({
  suggestion,
  artistKey,
  artistName,
  onAccept,
  onDismiss,
}: {
  suggestion: PendingGlossarySuggestion;
  artistKey: string;
  artistName: string;
  onAccept: (term: string) => void;
  onDismiss: (term: string) => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleAccept() {
    setLoading(true);
    try {
      await fetch(`/api/glossary/artist/${artistKey}/suggestions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "accept", term: suggestion.term, displayName: artistName }),
      });
      onAccept(suggestion.term);
    } finally {
      setLoading(false);
    }
  }

  async function handleDismiss() {
    setLoading(true);
    try {
      await fetch(`/api/glossary/artist/${artistKey}/suggestions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "dismiss", term: suggestion.term }),
      });
      onDismiss(suggestion.term);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-[12px] border border-[rgba(255,200,80,0.14)] bg-[rgba(255,200,80,0.04)] px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-[13px] text-[#ffc850]">{suggestion.term}</span>
          <span className="text-[rgba(255,255,255,0.3)]">→</span>
          <span className="text-[13px] text-[rgba(255,255,255,0.75)]">{suggestion.meaning}</span>
          <CategoryBadge category={suggestion.category} />
        </div>
        {suggestion.reason && (
          <p className="mt-1 text-[10px] leading-[1.5] text-[rgba(255,255,255,0.3)]">{suggestion.reason}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => { void handleAccept(); }}
          disabled={loading}
          className="rounded-full border border-[rgba(63,255,170,0.25)] bg-[rgba(63,255,170,0.08)] px-3 py-1 text-[10px] font-bold text-[#3fffaa] transition hover:bg-[rgba(63,255,170,0.15)] disabled:opacity-40"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => { void handleDismiss(); }}
          disabled={loading}
          className="rounded-full border border-[rgba(255,255,255,0.08)] px-3 py-1 text-[10px] font-semibold text-[rgba(255,255,255,0.3)] transition hover:text-white disabled:opacity-40"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

// ── Entry row ──────────────────────────────────────────────────────────────

function EntryRow({
  entry,
  artistKey,
  artistName,
  onDeleted,
  onEdited,
}: {
  entry: AiGlossaryEntry;
  artistKey: string;
  artistName: string;
  onDeleted: (term: string) => void;
  onEdited: (entry: AiGlossaryEntry) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await fetch(`/api/glossary/artist/${artistKey}?term=${encodeURIComponent(entry.term)}`, { method: "DELETE" });
      onDeleted(entry.term);
    } finally {
      setDeleting(false);
    }
  }

  if (editing) {
    return (
      <GlossaryForm
        initial={{ term: entry.term, meaning: entry.meaning, note: entry.note ?? "", category: entry.category ?? "preferred_rendering" }}
        artistName={artistName}
        artistKey={artistKey}
        onSaved={(updated) => { onEdited(updated); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="group flex items-start gap-3 rounded-[12px] border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)] px-4 py-3 transition hover:border-[rgba(255,20,100,0.14)] hover:bg-[rgba(255,20,100,0.03)]">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-[13px] text-white">{entry.term}</span>
          <span className="text-[rgba(255,255,255,0.3)]">→</span>
          <span className="text-[13px] text-[rgba(255,255,255,0.7)]">{entry.meaning}</span>
          <CategoryBadge category={entry.category} />
        </div>
        {entry.note && (
          <p className="mt-1 text-[11px] leading-[1.5] text-[rgba(255,255,255,0.35)]">{entry.note}</p>
        )}
        {entry.aliases && entry.aliases.length > 0 && (
          <p className="mt-0.5 text-[10px] text-[rgba(255,255,255,0.25)]">Also: {entry.aliases.join(", ")}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-full border border-[rgba(255,255,255,0.10)] p-1.5 text-[rgba(255,255,255,0.4)] transition hover:text-white"
          title="Edit"
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3 fill-current"><path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.609Z"/></svg>
        </button>
        <button
          type="button"
          onClick={() => { void handleDelete(); }}
          disabled={deleting}
          className="rounded-full border border-[rgba(255,20,100,0.15)] p-1.5 text-[rgba(255,20,100,0.5)] transition hover:bg-[rgba(255,20,100,0.1)] hover:text-[#ff1464] disabled:opacity-40"
          title="Delete"
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3 fill-current"><path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15Z"/></svg>
        </button>
      </div>
    </div>
  );
}

// ── Main card ──────────────────────────────────────────────────────────────

export function ArtistGlossaryCard({
  artistKey,
  artistName,
  fullPageHref,
  spotifyTrackIds,
}: {
  artistKey: string;
  artistName: string;
  fullPageHref?: string;
  /** Track IDs to scan for backfilling suggestions from existing drafts */
  spotifyTrackIds?: string[];
}) {
  const [entries, setEntries] = useState<AiGlossaryEntry[]>([]);
  const [suggestions, setSuggestions] = useState<PendingGlossarySuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [scanning, setScanning] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [glossaryRes, suggestionsRes] = await Promise.all([
        fetch(`/api/glossary/artist/${artistKey}`),
        fetch(`/api/glossary/artist/${artistKey}/suggestions`),
      ]);
      const glossaryData = (await glossaryRes.json()) as GlossaryApiResponse;
      const suggestionsData = (await suggestionsRes.json()) as SuggestionsApiResponse;
      if (glossaryData.success) setEntries(glossaryData.entries ?? []);
      if (suggestionsData.success) setSuggestions(suggestionsData.suggestions ?? []);
    } finally {
      setLoading(false);
    }
  }, [artistKey]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  function handleTermSaved(entry: AiGlossaryEntry) {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.term.toLowerCase() === entry.term.toLowerCase());
      if (idx >= 0) { const next = [...prev]; next[idx] = entry; return next; }
      return [...prev, entry];
    });
    setShowAddForm(false);
  }

  function handleTermDeleted(term: string) {
    setEntries((prev) => prev.filter((e) => e.term.toLowerCase() !== term.toLowerCase()));
  }

  function handleTermEdited(entry: AiGlossaryEntry) {
    setEntries((prev) => prev.map((e) => e.term.toLowerCase() === entry.term.toLowerCase() ? entry : e));
  }

  function handleSuggestionAccepted(term: string) {
    setSuggestions((prev) => prev.filter((s) => s.term.toLowerCase() !== term.toLowerCase()));
    setEntries((prev) => prev); // refetch to get new entry
    void fetchData();
  }

  function handleSuggestionDismissed(term: string) {
    setSuggestions((prev) => prev.filter((s) => s.term.toLowerCase() !== term.toLowerCase()));
  }

  async function handleScan() {
    if (!spotifyTrackIds || spotifyTrackIds.length === 0) return;
    setScanning(true);
    try {
      const res = await fetch(`/api/glossary/artist/${artistKey}/extract`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spotifyTrackIds }),
      });
      const data = (await res.json()) as { success?: boolean; extracted?: number };
      if (data.success && (data.extracted ?? 0) > 0) {
        await fetchData();
      }
    } finally {
      setScanning(false);
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 fill-[rgba(255,20,100,0.6)]" aria-hidden="true">
            <path d="M0 2.75A2.75 2.75 0 0 1 2.75 0h10.5A2.75 2.75 0 0 1 16 2.75v10.5A2.75 2.75 0 0 1 13.25 16H2.75A2.75 2.75 0 0 1 0 13.25Zm2.75-1.25c-.69 0-1.25.56-1.25 1.25v10.5c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25V2.75c0-.69-.56-1.25-1.25-1.25ZM4 5.75A.75.75 0 0 1 4.75 5h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 4 5.75Zm0 3A.75.75 0 0 1 4.75 8h4a.75.75 0 0 1 0 1.5h-4A.75.75 0 0 1 4 8.75Z"/>
          </svg>
          <p className="text-[11px] font-bold uppercase tracking-[2.2px] text-[rgba(255,20,100,0.65)]">
            Artist Glossary
          </p>
          {entries.length > 0 && (
            <span className="rounded-full border border-[rgba(255,20,100,0.18)] bg-[rgba(255,20,100,0.08)] px-2 py-0.5 text-[10px] font-bold text-[#ff6aaa]">
              {entries.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {fullPageHref && (
            <a
              href={fullPageHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(255,255,255,0.10)] px-3 py-1.5 text-[11px] font-semibold text-[rgba(255,255,255,0.4)] transition hover:border-[rgba(255,20,100,0.22)] hover:text-[#ff6aaa]"
              title="Open in full page"
            >
              <svg viewBox="0 0 16 16" className="h-3 w-3 fill-current" aria-hidden="true">
                <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"/>
              </svg>
              Full page
            </a>
          )}
          <button
            type="button"
            onClick={() => setShowAddForm((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(255,20,100,0.22)] bg-[rgba(255,20,100,0.07)] px-3 py-1.5 text-[11px] font-semibold text-[#ff6aaa] transition hover:bg-[rgba(255,20,100,0.14)]"
          >
            {showAddForm ? "✕ Cancel" : "+ Add term"}
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <GlossaryForm
          artistName={artistName}
          artistKey={artistKey}
          onSaved={handleTermSaved}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* AI suggestions */}
      {suggestions.length > 0 && (
        <div className="mb-4">
          <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[1.5px] text-[#ffc850]">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#ffc850] shadow-[0_0_6px_#ffc850]" />
            AI suggested · {suggestions.length} pending
          </p>
          <div className="space-y-2">
            {suggestions.map((s) => (
              <SuggestionRow
                key={s.term}
                suggestion={s}
                artistKey={artistKey}
                artistName={artistName}
                onAccept={handleSuggestionAccepted}
                onDismiss={handleSuggestionDismissed}
              />
            ))}
          </div>
        </div>
      )}

      {/* Entries */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-[12px] bg-[rgba(255,255,255,0.04)]" />
          ))}
        </div>
      ) : entries.length > 0 ? (
        <div className="space-y-2">
          {entries.map((entry) => (
            <EntryRow
              key={entry.term}
              entry={entry}
              artistKey={artistKey}
              artistName={artistName}
              onDeleted={handleTermDeleted}
              onEdited={handleTermEdited}
            />
          ))}
        </div>
      ) : !showAddForm && suggestions.length === 0 ? (
        <div className="rounded-[14px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-5 text-center">
          <p className="text-[13px] text-[rgba(255,255,255,0.3)]">No glossary terms yet.</p>
          <p className="mt-1 text-[11px] text-[rgba(255,255,255,0.2)]">
            Add terms manually, or let the AI scan existing translated songs to suggest vocabulary.
          </p>
          {spotifyTrackIds && spotifyTrackIds.length > 0 && (
            <button
              type="button"
              onClick={() => { void handleScan(); }}
              disabled={scanning}
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-[rgba(255,200,80,0.25)] bg-[rgba(255,200,80,0.07)] px-4 py-2 text-[11px] font-semibold text-[#ffc850] transition hover:bg-[rgba(255,200,80,0.14)] disabled:opacity-50"
            >
              {scanning ? (
                <>
                  <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-[#ffc850] border-t-transparent" />
                  Scanning {spotifyTrackIds.length} song{spotifyTrackIds.length !== 1 ? "s" : ""}…
                </>
              ) : (
                <>✦ Scan {spotifyTrackIds.length} existing song{spotifyTrackIds.length !== 1 ? "s" : ""} for vocabulary</>
              )}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
