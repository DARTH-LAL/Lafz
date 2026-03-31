"use client";

import { useState } from "react";
import type { LafzSettings } from "@/features/settings/types";

// ── Model cost table ──────────────────────────────────────────────────────
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "gpt-5.4":              { input: 2.5,  output: 15.0 },
  "gpt-5.4-mini":         { input: 0.75, output: 4.5 },
  "gpt-4.1":              { input: 2.0,  output: 8.0 },
  "gpt-4.1-mini":         { input: 0.4,  output: 1.6 },
  "gpt-4o":               { input: 2.5,  output: 10.0 },
  "gpt-4o-mini":          { input: 0.15, output: 0.6 },
  "claude-sonnet-4-20250514": { input: 3.0,  output: 15.0 },
  "claude-haiku-3-5-20241022": { input: 0.8,  output: 4.0 },
  "claude-opus-4-5":      { input: 15.0, output: 75.0 },
  "gemini-2.5-flash":     { input: 0.15, output: 0.6 },
  "gemini-2.0-flash":     { input: 0.10, output: 0.4 },
  "gemini-2.5-pro":       { input: 1.25, output: 5.0 },
};

// ── Sub-components ────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className="text-[10px] font-bold uppercase tracking-[2px] text-[rgba(255,20,100,0.7)]">{children}</span>
      <div className="h-px flex-1 bg-[rgba(255,20,100,0.12)]" />
    </div>
  );
}

function Card({ children, danger = false }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <div className={[
      "mb-3 rounded-[20px] p-6 backdrop-blur-xl",
      danger
        ? "border border-[rgba(255,80,80,0.15)] bg-[rgba(255,50,80,0.04)]"
        : "lafz-card"
    ].join(" ")}>
      {children}
    </div>
  );
}

function Row({ children, last = false }: { children: React.ReactNode; last?: boolean }) {
  return (
    <div className={["flex items-start justify-between gap-5 py-4", !last ? "border-b border-[rgba(255,255,255,0.05)]" : "pb-0"].join(" ")}>
      {children}
    </div>
  );
}

function Label({ title, desc, children }: { title: string; desc?: string; children?: React.ReactNode }) {
  return (
    <div className="flex-1">
      <p className="text-[14px] font-semibold text-[#fff0f6]">{title}</p>
      {desc && <p className="mt-1 text-[12px] leading-[1.6] text-white">{desc}</p>}
      {children}
    </div>
  );
}

function StyledSelect({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-w-[200px] appearance-none rounded-[10px] border border-[rgba(255,20,100,0.18)] bg-[rgba(255,20,100,0.07)] px-3 py-2 pr-8 text-[13px] font-medium text-[#fff0f6] outline-none transition focus:border-[rgba(255,20,100,0.45)]"
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='rgba(255,100,170,0.7)' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 10px center" }}
    >
      {children}
    </select>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        "relative h-[26px] w-[46px] flex-shrink-0 rounded-full border transition-all duration-200",
        checked
          ? "border-[rgba(255,20,100,0.5)] bg-[rgba(255,20,100,0.3)] shadow-[0_0_12px_rgba(255,20,100,0.3)]"
          : "border-[rgba(255,255,255,0.10)] bg-[rgba(255,255,255,0.08)]"
      ].join(" ")}
    >
      <span className={[
        "absolute top-[4px] h-[16px] w-[16px] rounded-full transition-all duration-200",
        checked
          ? "left-[26px] bg-[#ff1464] shadow-[0_0_8px_rgba(255,20,100,0.7)]"
          : "left-[4px] bg-[rgba(255,255,255,0.4)]"
      ].join(" ")} />
    </button>
  );
}

function ModelCostChips({ model, colorClass }: { model: string; colorClass: string }) {
  const cost = MODEL_COSTS[model];
  if (!cost) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-600 ${colorClass}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        ${cost.input.toFixed(2)} / 1M in
      </span>
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-600 ${colorClass}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        ${cost.output.toFixed(2)} / 1M out
      </span>
    </div>
  );
}

function ModelBadge({ provider }: { provider: "openai" | "anthropic" | "gemini" }) {
  const map = {
    openai:    "border-[rgba(255,77,150,0.3)]  bg-[rgba(255,77,150,0.12)]  text-[#ff4d96]",
    anthropic: "border-[rgba(162,89,255,0.3)]  bg-[rgba(162,89,255,0.12)]  text-[#a259ff]",
    gemini:    "border-[rgba(64,232,255,0.3)]   bg-[rgba(64,232,255,0.12)]   text-[#40e8ff]",
  };
  return (
    <span className={`ml-2 inline-block rounded-full border px-2 py-0.5 text-[9px] font-700 uppercase tracking-wide ${map[provider]}`}>
      {provider === "openai" ? "OpenAI" : provider === "anthropic" ? "Anthropic" : "Gemini"}
    </span>
  );
}

// ── Danger zone row ───────────────────────────────────────────────────────
function DangerRow({
  title, desc, label, action, onAction, last = false
}: {
  title: string; desc: string; label: string; action: string;
  onAction: (action: string) => void; last?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handle() {
    if (!confirming) { setConfirming(true); return; }
    setLoading(true);
    await onAction(action);
    setLoading(false);
    setConfirming(false);
  }

  return (
    <div className={["flex items-center justify-between gap-5 py-3", !last ? "border-b border-[rgba(255,80,80,0.08)]" : "pb-0"].join(" ")}>
      <div>
        <p className="text-[13px] font-semibold text-[rgba(255,180,180,0.8)]">{title}</p>
        <p className="mt-0.5 text-[11px] text-[rgba(255,100,100,0.5)]">{desc}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {confirming && (
          <span className="text-[11px] text-[rgba(255,180,180,0.7)]">Sure?</span>
        )}
        <button
          onClick={handle}
          disabled={loading}
          className={[
            "rounded-full border px-4 py-1.5 text-[11px] font-bold transition whitespace-nowrap",
            confirming
              ? "border-[rgba(255,50,80,0.5)] bg-[rgba(255,50,80,0.2)] text-[#ff8080]"
              : "border-[rgba(255,80,80,0.25)] bg-[rgba(255,50,80,0.08)] text-[rgba(255,100,100,0.7)] hover:bg-[rgba(255,50,80,0.2)] hover:text-[#ff8080]"
          ].join(" ")}
        >
          {loading ? "…" : confirming ? "Confirm" : label}
        </button>
        {confirming && (
          <button onClick={() => setConfirming(false)} className="rounded-full border border-[rgba(255,255,255,0.1)] px-3 py-1.5 text-[11px] text-[rgba(255,255,255,0.3)] transition hover:text-white">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────
export function SettingsClient({
  initialSettings,
  tokenExpiresInMin,
}: {
  initialSettings: LafzSettings;
  tokenExpiresInMin: number;
}) {
  const [s, setS] = useState<LafzSettings>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dangerMsg, setDangerMsg] = useState<string | null>(null);

  function update<K extends keyof LafzSettings>(key: K, value: LafzSettings[K]) {
    setS((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(s),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {}
    setSaving(false);
  }

  async function dangerAction(action: string) {
    const res = await fetch("/api/settings/danger", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = (await res.json()) as { message?: string };
    setDangerMsg(data.message ?? "Done.");
    setTimeout(() => setDangerMsg(null), 3500);
  }

  const tokenColor = tokenExpiresInMin > 30 ? "#3fffaa" : tokenExpiresInMin > 10 ? "#ffb347" : "#ff6464";
  const tokenBorder = tokenExpiresInMin > 30 ? "rgba(63,255,170,0.25)" : tokenExpiresInMin > 10 ? "rgba(255,179,71,0.25)" : "rgba(255,100,100,0.25)";
  const tokenBg = tokenExpiresInMin > 30 ? "rgba(63,255,170,0.10)" : tokenExpiresInMin > 10 ? "rgba(255,179,71,0.10)" : "rgba(255,100,100,0.10)";

  return (
    <>
      {/* Header */}
      <header className="mb-8 pb-6">
        <div className="mb-3 flex items-center gap-3">
          <div className="h-0.5 w-7 rounded-full bg-[linear-gradient(90deg,#ff1464,transparent)] shadow-[0_0_8px_#ff1464]" />
          <p className="text-[11px] font-bold uppercase tracking-[2.5px] text-[#ff1464] [text-shadow:0_0_16px_rgba(255,20,100,0.6)]">Settings</p>
        </div>
        <h1 className="font-display text-5xl font-extrabold leading-[1.04] tracking-[-2.2px] text-white [text-shadow:0_0_30px_rgba(255,255,255,0.30),0_0_70px_rgba(255,255,255,0.12)]">
          Configure your
          <br />
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage: "linear-gradient(110deg,#ff1464 0%,#ff8ab0 22%,#ffffff 45%,#ff8ab0 68%,#ff1464 100%)",
              backgroundSize: "250% 100%",
              animation: "lafz-shimmer 3.5s linear infinite",
              filter: "drop-shadow(0 0 18px rgba(255,20,100,0.55))"
            }}
          >
            Lafz settings.
          </span>
        </h1>
      </header>

      {/* ── AI Pipeline ── */}
      <section className="mb-7">
        <SectionTitle>AI Pipeline</SectionTitle>
        <Card>
          {/* Generator A */}
          <Row>
            <Label
              title="Generator A"
              desc="First-pass translation model. Tends to be more literal and structured."
            >
              <ModelBadge provider="openai" />
              <ModelCostChips model={s.generatorAModel} colorClass="border-[rgba(255,77,150,0.2)] bg-[rgba(255,77,150,0.10)] text-[#ff4d96]" />
            </Label>
            <StyledSelect value={s.generatorAModel} onChange={(v) => update("generatorAModel", v)}>
              <option value="gpt-5.4-mini">GPT-5.4 Mini (default)</option>
              <option value="gpt-5.4">GPT-5.4 (best)</option>
              <option value="gpt-5.1">GPT-5.1</option>
              <option value="gpt-5-mini">GPT-5 Mini (cheaper)</option>
              <option value="gpt-4.1">GPT-4.1</option>
              <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
              <option value="gpt-4o">GPT-4o</option>
              <option value="gpt-4o-mini">GPT-4o Mini</option>
            </StyledSelect>
          </Row>

          {/* Generator B */}
          <Row>
            <Label
              title="Generator B"
              desc="Second-pass translation model. Often more poetic and natural-sounding."
            >
              <ModelBadge provider="anthropic" />
              <ModelCostChips model={s.generatorBModel} colorClass="border-[rgba(162,89,255,0.2)] bg-[rgba(162,89,255,0.10)] text-[#a259ff]" />
            </Label>
            <StyledSelect value={s.generatorBModel} onChange={(v) => update("generatorBModel", v)}>
              <option value="claude-sonnet-4-20250514">Claude Sonnet 4.5 (default)</option>
              <option value="claude-haiku-3-5-20241022">Claude Haiku 3.5 (cheaper)</option>
              <option value="claude-opus-4-5">Claude Opus 4.5 (best)</option>
            </StyledSelect>
          </Row>

          {/* Judge */}
          <Row last>
            <Label
              title="Judge"
              desc="Evaluates both drafts and selects the best translation per line."
            >
              <ModelBadge provider="gemini" />
              <ModelCostChips model={s.judgeModel} colorClass="border-[rgba(64,232,255,0.2)] bg-[rgba(64,232,255,0.10)] text-[#40e8ff]" />
            </Label>
            <StyledSelect value={s.judgeModel} onChange={(v) => update("judgeModel", v)}>
              <option value="gemini-2.5-flash">Gemini 2.5 Flash (default)</option>
              <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
              <option value="gemini-2.5-pro">Gemini 2.5 Pro (best)</option>
            </StyledSelect>
          </Row>
        </Card>
      </section>

      {/* ── Translation Defaults ── */}
      <section className="mb-7">
        <SectionTitle>Translation Defaults</SectionTitle>
        <Card>
          <Row>
            <Label title="Target language" desc="Default language new translations are written in." />
            <StyledSelect value={s.targetLanguage} onChange={(v) => update("targetLanguage", v)}>
              {["English","Hindi","Spanish","French","German","Portuguese","Japanese","Korean","Arabic","Italian"].map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </StyledSelect>
          </Row>

          <Row>
            <Label title="Translation style" desc="How closely the AI should follow the original lyrics." />
            <StyledSelect value={s.translationStyle} onChange={(v) => update("translationStyle", v as LafzSettings["translationStyle"])}>
              <option value="balanced">Balanced (default)</option>
              <option value="literal">Literal — word-for-word</option>
              <option value="poetic">Poetic — natural flow</option>
              <option value="cultural">Cultural — localised idioms</option>
            </StyledSelect>
          </Row>

          <Row>
            <Label title="Auto-approve threshold" desc="Lines with confidence above this are automatically marked reviewed." />
            <div className="flex items-center gap-3">
              <input
                type="range" min={50} max={100} value={s.autoApproveThreshold}
                onChange={(e) => update("autoApproveThreshold", Number(e.target.value))}
                className="w-[160px] accent-[#ff1464]"
              />
              <span className="min-w-[38px] text-right text-[13px] font-bold text-[#ff6aaa]">
                {s.autoApproveThreshold}%
              </span>
            </div>
          </Row>

          <Row>
            <Label title="Auto-fetch lyrics" desc="Automatically fetch lyrics when a new track is added to the library." />
            <Toggle checked={s.autoFetchLyrics} onChange={(v) => update("autoFetchLyrics", v)} />
          </Row>

          <Row last>
            <Label title="Keep both AI drafts" desc="Store Generator A and B outputs separately, even after the judge picks a winner." />
            <Toggle checked={s.keepBothDrafts} onChange={(v) => update("keepBothDrafts", v)} />
          </Row>
        </Card>
      </section>

      {/* ── Budget & Costs ── */}
      <section className="mb-7">
        <SectionTitle>Budget &amp; Costs</SectionTitle>
        <Card>
          <Row>
            <Label title="Monthly spend limit" desc="Lafz will warn you once this limit is reached." />
            <div className="flex items-center gap-1 rounded-[10px] border border-[rgba(255,20,100,0.18)] bg-[rgba(255,20,100,0.07)] px-3 py-2">
              <span className="text-[13px] font-semibold text-[rgba(255,100,170,0.7)]">$</span>
              <input
                type="number" min={0} step={0.5} value={s.monthlySpendLimit}
                onChange={(e) => update("monthlySpendLimit", Number(e.target.value))}
                className="w-[80px] bg-transparent text-[13px] font-medium text-[#fff0f6] outline-none"
              />
            </div>
          </Row>

          <Row>
            <Label title="Alert threshold" desc="Show a warning when spend reaches this % of your limit." />
            <div className="flex items-center gap-3">
              <input
                type="range" min={10} max={100} value={s.alertThreshold}
                onChange={(e) => update("alertThreshold", Number(e.target.value))}
                className="w-[160px] accent-[#ff1464]"
              />
              <span className="min-w-[38px] text-right text-[13px] font-bold text-[#ff6aaa]">
                {s.alertThreshold}%
              </span>
            </div>
          </Row>
        </Card>
      </section>

      {/* ── Library ── */}
      <section className="mb-7">
        <SectionTitle>Library</SectionTitle>
        <Card>
          <Row>
            <Label title="Default view" desc="Whether the library opens in card grid or list view." />
            <StyledSelect value={s.defaultView} onChange={(v) => update("defaultView", v as "grid" | "list")}>
              <option value="grid">Grid (default)</option>
              <option value="list">List</option>
            </StyledSelect>
          </Row>

          <Row>
            <Label title="Default sort" desc="How tracks are ordered when you open the library." />
            <StyledSelect value={s.defaultSort} onChange={(v) => update("defaultSort", v as LafzSettings["defaultSort"])}>
              <option value="status">Status</option>
              <option value="recently_updated">Recently updated</option>
              <option value="title">Title A–Z</option>
              <option value="artist">Artist A–Z</option>
            </StyledSelect>
          </Row>

          <Row last>
            <Label title='Show "No Lyrics" tracks' desc="Include tracks that have no lyrics fetched yet in the library view." />
            <Toggle checked={s.showNoLyricsTracks} onChange={(v) => update("showNoLyricsTracks", v)} />
          </Row>
        </Card>
      </section>

      {/* ── Spotify Account ── */}
      <section className="mb-7">
        <SectionTitle>Spotify Account</SectionTitle>
        <Card>
          <div className="mb-5 flex items-center gap-4 rounded-[14px] border border-[rgba(29,185,84,0.2)] bg-[rgba(29,185,84,0.07)] p-4">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#1db954,#0d7a35)] text-lg font-black text-white">
              ♪
            </div>
            <div className="flex-1">
              <p className="text-[14px] font-bold text-[#fff0f6]">Spotify Connected</p>
              <p className="text-[12px] text-[rgba(255,255,255,0.4)]">Your Spotify account is linked and active.</p>
            </div>
            <span className="rounded-full border border-[rgba(29,185,84,0.35)] bg-[rgba(29,185,84,0.15)] px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-[#1db954]">
              ● Connected
            </span>
          </div>

          <Row last>
            <Label title="Token status" desc="Your Spotify access token refreshes automatically in the background." />
            <span
              className="rounded-full border px-3 py-1.5 text-[12px] font-bold"
              style={{ color: tokenColor, borderColor: tokenBorder, background: tokenBg }}
            >
              {tokenExpiresInMin > 0 ? `✓ Valid · expires in ${tokenExpiresInMin} min` : "⚠ Token expired — reload page"}
            </span>
          </Row>
        </Card>
      </section>

      {/* ── Danger Zone ── */}
      <section className="mb-24">
        <SectionTitle>Danger Zone</SectionTitle>
        <Card danger>
          {dangerMsg && (
            <div className="mb-4 rounded-[10px] border border-[rgba(63,255,170,0.25)] bg-[rgba(63,255,170,0.08)] px-4 py-2.5 text-[12px] font-semibold text-[#3fffaa]">
              {dangerMsg}
            </div>
          )}
          <DangerRow title="Clear lyrics cache" desc="Deletes all cached lyrics files. They can be re-fetched." label="Clear Cache" action="clear-lyrics-cache" onAction={dangerAction} />
          <DangerRow title="Delete all AI drafts" desc="Removes every AI-generated draft. Finalized translations are unaffected." label="Delete Drafts" action="delete-drafts" onAction={dangerAction} />
          <DangerRow title="Reset usage analytics" desc="Wipes usage-runs.json. Analytics will start from zero." label="Reset Analytics" action="reset-analytics" onAction={dangerAction} />
          <DangerRow title="Wipe entire library" desc="Deletes all playlists, translations, drafts and lyrics. Cannot be undone." label="Wipe All Data" action="wipe-all" onAction={dangerAction} last />
        </Card>
      </section>

      {/* ── Sticky Save Bar ── */}
      <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-end gap-3 bg-[linear-gradient(to_top,rgba(6,4,16,0.98)_60%,transparent)] px-8 py-5">
        {saved && (
          <span className="flex items-center gap-2 rounded-full border border-[rgba(63,255,170,0.3)] bg-[rgba(63,255,170,0.12)] px-4 py-2 text-[13px] font-bold text-[#3fffaa] transition">
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="2,8 6,12 14,4" />
            </svg>
            Changes saved
          </span>
        )}
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-full bg-[linear-gradient(135deg,#ff1464,#ff6aaa)] px-7 py-3 text-[14px] font-bold text-white shadow-[0_0_24px_rgba(255,20,100,0.4)] transition hover:shadow-[0_0_36px_rgba(255,20,100,0.65)] hover:-translate-y-0.5 disabled:opacity-60"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 2H4L2 4v10h12V4l-1-2z" /><rect x="5" y="9" width="6" height="5" /><rect x="5" y="2" width="5" height="4" />
          </svg>
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </>
  );
}
