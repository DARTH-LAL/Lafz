"use client";

import { useState, useEffect, useCallback } from "react";
import fs from "node:fs";
import path from "node:path";

type AnalyticsData = {
  period: string;
  trackCount: number;
  totalLines: number;
  winRate: { a: number; b: number; blend: number };
  confidence: { high: number; med: number; low: number };
  generatorA: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    avgDurationMs: number;
    cost: number;
  };
  generatorB: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    avgDurationMs: number;
    cost: number;
  };
  judge: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    avgDurationMs: number;
    cost: number;
  };
  speed: { avgDurA: number; avgDurB: number; avgDurG: number; avgTotal: number };
  languageStats: Array<{ lang: string; pct: number }>;
  recentTracks: Array<{
    title: string;
    artist: string;
    lines: number;
    winnerModel: string;
    confidence: string;
  }>;
} | null;

type ReasonItem = {
  winner: string;
  original: string;
  chosen: string;
  reason: string;
  track: string;
  lineIndex: number;
};

type Period = "24h" | "7d" | "30d" | "all";

function formatTokens(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k tokens`;
  return `${n} tokens`;
}

function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function periodLabel(p: Period): string {
  if (p === "24h") return "24 hours";
  if (p === "7d") return "7 days";
  if (p === "30d") return "30 days";
  return "All time";
}

function getProviderLabel(model: string): string {
  if (/gemini/i.test(model)) return "Gemini";
  if (/claude/i.test(model)) return "Anthropic";
  if (/gpt|openai/i.test(model)) return "OpenAI";
  return model;
}

type Props = {
  initialData: AnalyticsData;
  initialPeriod: Period;
  reasoningItems?: ReasonItem[];
};

export default function AnalyticsDashboard({ initialData, initialPeriod, reasoningItems = [] }: Props) {
  const [data, setData] = useState<AnalyticsData>(initialData);
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const [loading, setLoading] = useState(false);
  const [reasons, setReasons] = useState<ReasonItem[]>(reasoningItems);

  const fetchData = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/analytics?period=${p}`);
      if (res.ok) {
        const json = await res.json() as { success: boolean; data: AnalyticsData };
        setData(json.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handlePeriod = (p: Period) => {
    setPeriod(p);
    void fetchData(p);
  };

  // Fetch reasoning items from last draft on client side
  useEffect(() => {
    if (reasoningItems.length > 0) return;
    fetch("/api/analytics/reasoning")
      .then(r => r.ok ? r.json() : null)
      .then((json: { items?: ReasonItem[] } | null) => {
        if (json?.items) setReasons(json.items);
      })
      .catch(() => undefined);
  }, [reasoningItems]);

  const opacity = loading ? 0.5 : 1;

  const BG = "rgba(6,2,5,0.92)";
  const PINK = "#ff1464";
  const PINK_LIGHT = "#ff4d96";
  const VIOLET = "#a259ff";
  const CYAN = "#40e8ff";
  const GREEN = "#3fffaa";
  const ORANGE = "#ff9f40";

  const maxSpeed = data ? Math.max(data.speed.avgDurA, data.speed.avgDurB, data.speed.avgDurG, data.speed.avgTotal, 1) : 1;

  const periods: { value: Period; label: string }[] = [
    { value: "24h", label: "24H" },
    { value: "7d", label: "7D" },
    { value: "30d", label: "30D" },
    { value: "all", label: "All Time" },
  ];

  const donutGradient = data
    ? `conic-gradient(#3fffaa 0% ${data.confidence.high}%, #ff9f40 ${data.confidence.high}% ${data.confidence.high + data.confidence.med}%, #ff4d96 ${data.confidence.high + data.confidence.med}% 100%)`
    : `conic-gradient(#3fffaa 0% 52%, #ff9f40 52% 78%, #ff4d96 78% 100%)`;

  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        maxWidth: 1280,
        margin: "0 auto",
        padding: "48px 32px 80px",
        opacity,
        transition: "opacity 0.2s"
      }}
    >
      {/* Background effects */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.07) 1px, transparent 1px)",
        backgroundSize: "28px 28px"
      }} />
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse 60% 40% at 15% 20%, rgba(255,20,100,0.12) 0%, transparent 70%), radial-gradient(ellipse 50% 35% at 85% 75%, rgba(120,60,255,0.10) 0%, transparent 70%)"
      }} />

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 36, flexWrap: "wrap", gap: 20 }}>
        <div>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.2em", color: PINK, textTransform: "uppercase",
            display: "flex", alignItems: "center", gap: 10, marginBottom: 10
          }}>
            AI Analytics
            <span style={{ flex: 1, height: 1, background: `linear-gradient(90deg, rgba(255,20,100,0.5), transparent)`, maxWidth: 160, display: "block" }} />
          </div>
          <h1 style={{
            fontSize: 48, fontWeight: 800, letterSpacing: "-0.022em", lineHeight: 1.04,
            margin: 0, marginBottom: 12, color: "#fff",
            textShadow: "0 0 30px rgba(255,255,255,0.30), 0 0 70px rgba(255,255,255,0.12)"
          }}>
            Model Performance
            <br />
            <span style={{
              backgroundImage: "linear-gradient(110deg,#ff1464 0%,#ff8ab0 22%,#ffffff 45%,#ff8ab0 68%,#ff1464 100%)",
              backgroundSize: "250% 100%",
              animation: "lafz-shimmer 3.5s linear infinite",
              filter: "drop-shadow(0 0 18px rgba(255,20,100,0.55))",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              backgroundClip: "text"
            }}>
              for your music.
            </span>
          </h1>
        </div>

        {/* Filter pills */}
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          background: "rgba(6,2,5,0.92)", border: "1px solid rgba(255,20,100,0.25)",
          borderRadius: 12, padding: 4
        }}>
          {periods.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => handlePeriod(value)}
              style={{
                fontSize: 12, fontWeight: 600, letterSpacing: "0.04em",
                padding: "7px 16px", borderRadius: 8,
                border: period === value ? "1px solid rgba(255,20,100,0.60)" : "1px solid transparent",
                cursor: "pointer",
                color: period === value ? "#fff" : "rgba(255,255,255,0.6)",
                background: period === value
                  ? "linear-gradient(135deg, rgba(255,20,100,0.40), rgba(162,89,255,0.28))"
                  : "transparent",
                boxShadow: period === value
                  ? "0 0 0 1px rgba(255,20,100,0.15), 0 0 14px rgba(255,20,100,0.55), 0 0 28px rgba(255,20,100,0.22)"
                  : "none",
                transition: "all 0.18s"
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!data ? (
        /* Empty state */
        <div style={{
          textAlign: "center", padding: "80px 20px", color: "rgba(255,255,255,0.5)", fontSize: 13
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: "#fff" }}>No data yet</div>
          <div>Run the OpenAI + Gemini translation pipeline on a track to start seeing analytics.</div>
        </div>
      ) : (
        <>
          {/* Model Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, marginBottom: 20 }}>
            {/* Generator A */}
            <div style={{
              background: BG, borderRadius: 18, padding: 24,
              border: "1px solid rgba(255,20,100,0.45)", position: "relative", overflow: "hidden",
              boxShadow: "0 0 0 1px rgba(255,20,100,0.10), 0 0 20px rgba(255,20,100,0.30), 0 0 48px rgba(255,20,100,0.12)",
              transition: "transform 0.2s"
            }}>
              <div style={{ position: "absolute", top: -40, right: -40, width: 140, height: 140, background: "radial-gradient(circle,rgba(255,20,100,0.18),transparent 70%)", pointerEvents: "none" }} />
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: PINK_LIGHT, marginBottom: 6 }}>Generator A</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 2 }}>{data.generatorA.model}</div>
              <div style={{ fontSize: 12, color: "#fff", marginBottom: 20 }}>{getProviderLabel(data.generatorA.model)}</div>
              <div style={{ fontSize: 11, color: "#fff", textTransform: "uppercase", letterSpacing: "0.1em" }}>Win Rate</div>
              <div style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, color: PINK_LIGHT }}>{data.winRate.a}%</div>
              <div style={{ width: "100%", height: 5, background: "rgba(255,20,100,0.08)", borderRadius: 99, overflow: "hidden", margin: "14px 0" }}>
                <div style={{ height: "100%", borderRadius: 99, background: `linear-gradient(90deg,${PINK},${PINK_LIGHT})`, width: `${data.winRate.a}%`, transition: "width 0.5s ease" }} />
              </div>
              <div style={{ display: "flex", gap: 16 }}>
                <div style={{ fontSize: 12, color: "#fff" }}>Avg confidence <span style={{ color: "#fff", fontWeight: 600 }}>{data.confidence.high}%</span></div>
                <div style={{ fontSize: 12, color: "#fff" }}>Tracks <span style={{ color: "#fff", fontWeight: 600 }}>{data.trackCount}</span></div>
              </div>
            </div>

            {/* Generator B */}
            <div style={{
              background: BG, borderRadius: 18, padding: 24,
              border: "1px solid rgba(162,89,255,0.45)", position: "relative", overflow: "hidden",
              boxShadow: "0 0 0 1px rgba(162,89,255,0.10), 0 0 20px rgba(162,89,255,0.30), 0 0 48px rgba(162,89,255,0.12)"
            }}>
              <div style={{ position: "absolute", top: -40, right: -40, width: 140, height: 140, background: "radial-gradient(circle,rgba(162,89,255,0.18),transparent 70%)", pointerEvents: "none" }} />
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: VIOLET, marginBottom: 6 }}>Generator B</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 2 }}>{data.generatorB.model}</div>
              <div style={{ fontSize: 12, color: "#fff", marginBottom: 20 }}>{getProviderLabel(data.generatorB.model)}</div>
              <div style={{ fontSize: 11, color: "#fff", textTransform: "uppercase", letterSpacing: "0.1em" }}>Win Rate</div>
              <div style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, color: VIOLET }}>{data.winRate.b}%</div>
              <div style={{ width: "100%", height: 5, background: "rgba(255,20,100,0.08)", borderRadius: 99, overflow: "hidden", margin: "14px 0" }}>
                <div style={{ height: "100%", borderRadius: 99, background: "linear-gradient(90deg,#7b2fff,#a259ff)", width: `${data.winRate.b}%`, transition: "width 0.5s ease" }} />
              </div>
              <div style={{ display: "flex", gap: 16 }}>
                <div style={{ fontSize: 12, color: "#fff" }}>Avg confidence <span style={{ color: "#fff", fontWeight: 600 }}>{data.confidence.med}%</span></div>
                <div style={{ fontSize: 12, color: "#fff" }}>Tracks <span style={{ color: "#fff", fontWeight: 600 }}>{data.trackCount}</span></div>
              </div>
            </div>

            {/* Judge */}
            <div style={{
              background: BG, borderRadius: 18, padding: 24,
              border: "1px solid rgba(64,232,255,0.45)", position: "relative", overflow: "hidden",
              boxShadow: "0 0 0 1px rgba(64,232,255,0.10), 0 0 20px rgba(64,232,255,0.30), 0 0 48px rgba(64,232,255,0.12)"
            }}>
              <div style={{ position: "absolute", top: -40, right: -40, width: 140, height: 140, background: "radial-gradient(circle,rgba(64,232,255,0.18),transparent 70%)", pointerEvents: "none" }} />
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: CYAN, marginBottom: 6 }}>Judge</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 2 }}>{data.judge.model}</div>
              <div style={{ fontSize: 12, color: "#fff", marginBottom: 20 }}>Google</div>
              <div style={{ fontSize: 11, color: "#fff", textTransform: "uppercase", letterSpacing: "0.1em" }}>Blended Lines</div>
              <div style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, color: CYAN }}>{data.winRate.blend}%</div>
              <div style={{ width: "100%", height: 5, background: "rgba(255,20,100,0.08)", borderRadius: 99, overflow: "hidden", margin: "14px 0" }}>
                <div style={{ height: "100%", borderRadius: 99, background: "linear-gradient(90deg,#00c8e0,#40e8ff)", width: `${data.winRate.blend}%`, transition: "width 0.5s ease" }} />
              </div>
              <div style={{ display: "flex", gap: 16 }}>
                <div style={{ fontSize: 12, color: "#fff" }}>Avg latency <span style={{ color: "#fff", fontWeight: 600 }}>{data.speed.avgDurG}s</span></div>
                <div style={{ fontSize: 12, color: "#fff" }}>Evals <span style={{ color: "#fff", fontWeight: 600 }}>{data.trackCount}</span></div>
              </div>
            </div>
          </div>

          {/* Winner Distribution + Confidence Donut */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
            {/* Winner dist */}
            <div style={{ background: BG, border: "1px solid rgba(255,20,100,0.40)", borderRadius: 16, padding: 22, boxShadow: "0 0 0 1px rgba(255,20,100,0.10), 0 0 20px rgba(255,20,100,0.28), 0 0 48px rgba(255,20,100,0.10)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,20,100,0.65)" }}>Winner Distribution</div>
                <div style={{ fontSize: 11, padding: "3px 10px", borderRadius: 99, background: "rgba(255,20,100,0.12)", color: PINK_LIGHT, border: "1px solid rgba(255,20,100,0.2)" }}>
                  {data.totalLines.toLocaleString()} lines
                </div>
              </div>
              <div style={{ display: "flex", height: 32, borderRadius: 10, overflow: "hidden", marginBottom: 12 }}>
                <div style={{ flex: data.winRate.a / 100, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, background: "rgba(255,20,100,0.7)", transition: "flex 0.5s ease" }}>
                  {data.winRate.a}%
                </div>
                <div style={{ flex: data.winRate.b / 100, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, background: "rgba(162,89,255,0.7)", transition: "flex 0.5s ease" }}>
                  {data.winRate.b}%
                </div>
                <div style={{ flex: data.winRate.blend / 100, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, background: "rgba(64,232,255,0.5)", transition: "flex 0.5s ease" }}>
                  {data.winRate.blend}%
                </div>
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
                <div style={{ fontSize: 12, color: "#fff", display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: PINK_LIGHT }} />
                  Generator A ({getProviderLabel(data.generatorA.model)})
                </div>
                <div style={{ fontSize: 12, color: "#fff", display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: VIOLET }} />
                  Generator B ({getProviderLabel(data.generatorB.model)})
                </div>
                <div style={{ fontSize: 12, color: "#fff", display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: CYAN }} />
                  Blended
                </div>
              </div>
            </div>

            {/* Confidence donut */}
            <div style={{ background: BG, border: "1px solid rgba(255,20,100,0.40)", borderRadius: 16, padding: 22, boxShadow: "0 0 0 1px rgba(255,20,100,0.10), 0 0 20px rgba(255,20,100,0.28), 0 0 48px rgba(255,20,100,0.10)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,20,100,0.65)", marginBottom: 16 }}>Confidence Breakdown</div>
              <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <div style={{
                  width: 100, height: 100, borderRadius: "50%",
                  background: donutGradient,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, position: "relative", transition: "background 0.5s"
                }}>
                  <div style={{ position: "absolute", width: 64, height: 64, background: "rgba(6,2,5,0.92)", borderRadius: "50%" }} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: GREEN, flexShrink: 0 }} />
                    <span style={{ color: "#fff" }}>High confidence</span>
                    <span style={{ color: "#fff", fontWeight: 600, marginLeft: "auto", paddingLeft: 12 }}>{data.confidence.high}%</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: ORANGE, flexShrink: 0 }} />
                    <span style={{ color: "#fff" }}>Medium</span>
                    <span style={{ color: "#fff", fontWeight: 600, marginLeft: "auto", paddingLeft: 12 }}>{data.confidence.med}%</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: PINK_LIGHT, flexShrink: 0 }} />
                    <span style={{ color: "#fff" }}>Low / flagged</span>
                    <span style={{ color: "#fff", fontWeight: 600, marginLeft: "auto", paddingLeft: 12 }}>{data.confidence.low}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Speed + Cost + Language */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, marginBottom: 20 }}>
            {/* Speed */}
            <div style={{ background: BG, border: "1px solid rgba(255,20,100,0.40)", borderRadius: 16, padding: 22, boxShadow: "0 0 0 1px rgba(255,20,100,0.10), 0 0 20px rgba(255,20,100,0.28), 0 0 48px rgba(255,20,100,0.10)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,20,100,0.65)", marginBottom: 16 }}>Avg Pipeline Speed</div>
              {[
                { label: `Generator A (${getProviderLabel(data.generatorA.model)})`, val: data.speed.avgDurA, color: `linear-gradient(90deg,${PINK},${PINK_LIGHT})` },
                { label: `Generator B (${getProviderLabel(data.generatorB.model)})`, val: data.speed.avgDurB, color: "linear-gradient(90deg,#7b2fff,#a259ff)" },
                { label: `Judge (${getProviderLabel(data.judge.model)})`, val: data.speed.avgDurG, color: "linear-gradient(90deg,#00c8e0,#40e8ff)" },
                { label: "Total avg", val: data.speed.avgTotal, color: `linear-gradient(90deg,${PINK},${VIOLET},${CYAN})` },
              ].map(({ label, val, color }, index) => (
                <div key={`${label}-${index}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid rgba(255,20,100,0.08)" }}>
                  <div style={{ fontSize: 13, color: "#fff", flex: 1 }}>{label}</div>
                  <div style={{ flex: 2, height: 6, background: "rgba(255,20,100,0.08)", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 99, background: color, width: `${Math.min(100, (val / maxSpeed) * 100)}%`, transition: "width 0.5s ease" }} />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", width: 48, textAlign: "right" }}>{val}s</div>
                </div>
              ))}
            </div>

            {/* Cost */}
            <div style={{ background: BG, border: "1px solid rgba(255,20,100,0.40)", borderRadius: 16, padding: 22, boxShadow: "0 0 0 1px rgba(255,20,100,0.10), 0 0 20px rgba(255,20,100,0.28), 0 0 48px rgba(255,20,100,0.10)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,20,100,0.65)" }}>Estimated Cost</div>
                <div style={{ fontSize: 11, padding: "3px 10px", borderRadius: 99, background: "rgba(255,20,100,0.12)", color: PINK_LIGHT, border: "1px solid rgba(255,20,100,0.2)" }}>
                  {periodLabel(period)}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
                {[
                  { label: getProviderLabel(data.generatorA.model), val: data.generatorA.cost, tokens: data.generatorA.inputTokens + data.generatorA.outputTokens, color: PINK_LIGHT },
                  { label: getProviderLabel(data.generatorB.model), val: data.generatorB.cost, tokens: data.generatorB.inputTokens + data.generatorB.outputTokens, color: VIOLET },
                  { label: getProviderLabel(data.judge.model), val: data.judge.cost, tokens: data.judge.inputTokens + data.judge.outputTokens, color: CYAN },
                ].map(({ label, val, tokens, color }, index) => (
                  <div key={`${label}-${index}`} style={{ background: "rgba(255,20,100,0.05)", border: "1px solid rgba(255,20,100,0.12)", borderRadius: 12, padding: 14, textAlign: "center" }}>
                    <div style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "#fff", marginBottom: 6 }}>{label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color }}>{formatCost(val)}</div>
                    <div style={{ fontSize: 11, color: "#fff", marginTop: 3 }}>{formatTokens(tokens)}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid rgba(255,20,100,0.12)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#fff" }}>Total spend</span>
                <span style={{ fontSize: 22, fontWeight: 800, color: GREEN }}>
                  {formatCost(data.generatorA.cost + data.generatorB.cost + data.judge.cost)}
                </span>
              </div>
            </div>

            {/* Language breakdown */}
            <div style={{ background: BG, border: "1px solid rgba(255,20,100,0.40)", borderRadius: 16, padding: 22, boxShadow: "0 0 0 1px rgba(255,20,100,0.10), 0 0 20px rgba(255,20,100,0.28), 0 0 48px rgba(255,20,100,0.10)" }}>
              <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,20,100,0.65)", marginBottom: 16 }}>Low-Conf by Language</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {data.languageStats.length === 0 ? (
                  <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 13 }}>No data</div>
                ) : (
                  data.languageStats.map(({ lang, pct }) => (
                    <div key={lang} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ fontSize: 12, color: "#fff", width: 80, flexShrink: 0 }}>{lang}</div>
                      <div style={{ flex: 1, height: 7, background: "rgba(255,20,100,0.08)", borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: 99, background: `linear-gradient(90deg,${PINK},${VIOLET})`, width: `${pct}%`, transition: "width 0.5s ease" }} />
                      </div>
                      <div style={{ fontSize: 12, color: "#fff", width: 36, textAlign: "right" }}>{pct}%</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Recent Tracks + Reasoning Feed */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            {/* Recent Tracks */}
            <div style={{ background: BG, border: "1px solid rgba(255,20,100,0.40)", borderRadius: 16, padding: 22, boxShadow: "0 0 0 1px rgba(255,20,100,0.10), 0 0 20px rgba(255,20,100,0.28), 0 0 48px rgba(255,20,100,0.10)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,20,100,0.65)" }}>Recent Translations</div>
                <div style={{ fontSize: 11, padding: "3px 10px", borderRadius: 99, background: "rgba(255,20,100,0.12)", color: PINK_LIGHT, border: "1px solid rgba(255,20,100,0.2)" }}>
                  Last {data.recentTracks.length}
                </div>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Track", "Lines", "Winner", "Confidence"].map(h => (
                      <th key={h} style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "#fff", textAlign: "left", padding: "8px 12px", borderBottom: "1px solid rgba(255,20,100,0.12)" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.recentTracks.map((t, i) => (
                    <tr key={i}>
                      <td style={{ padding: "12px 12px", borderBottom: "1px solid rgba(255,20,100,0.08)" }}>
                        <div style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>{t.title}</div>
                        <div style={{ color: "#fff", fontSize: 11 }}>{t.artist}</div>
                      </td>
                      <td style={{ padding: "12px 12px", fontSize: 13, color: "#fff", borderBottom: "1px solid rgba(255,20,100,0.08)" }}>{t.lines}</td>
                      <td style={{ padding: "12px 12px", borderBottom: "1px solid rgba(255,20,100,0.08)" }}>
                        <WinnerBadge winner={t.winnerModel} />
                      </td>
                      <td style={{ padding: "12px 12px", borderBottom: "1px solid rgba(255,20,100,0.08)" }}>
                        <ConfBadge conf={t.confidence} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Judge Reasoning Feed */}
            <div style={{ background: BG, border: "1px solid rgba(255,20,100,0.40)", borderRadius: 16, padding: 22, boxShadow: "0 0 0 1px rgba(255,20,100,0.10), 0 0 20px rgba(255,20,100,0.28), 0 0 48px rgba(255,20,100,0.10)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,20,100,0.65)" }}>Judge Reasoning Feed</div>
                <div style={{ fontSize: 11, padding: "3px 10px", borderRadius: 99, background: "rgba(255,20,100,0.12)", color: PINK_LIGHT, border: "1px solid rgba(255,20,100,0.2)" }}>
                  Last 6 decisions
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 340, overflowY: "auto" }}>
                {reasons.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "20px", color: "rgba(255,255,255,0.5)", fontSize: 13 }}>
                    No judge reasoning available yet.
                  </div>
                ) : (
                  reasons.slice(0, 6).map((item, i) => (
                    <div
                      key={i}
                      style={{
                        background: "rgba(6,2,5,0.92)",
                        border: "1px solid rgba(255,20,100,0.12)",
                        borderLeft: `2px solid ${item.winner === "generator_a" ? PINK_LIGHT : item.winner === "generator_b" ? VIOLET : CYAN}`,
                        borderRadius: 10,
                        padding: "12px 14px"
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <WinnerBadge winner={item.winner === "generator_a" ? "a" : item.winner === "generator_b" ? "b" : "blend"} />
                        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.6)" }}>{item.track} · line {item.lineIndex}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "#fff", marginBottom: 4 }}>{item.original}</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 6 }}>&ldquo;{item.chosen}&rdquo;</div>
                      <div style={{ fontSize: 12, color: "#fff", lineHeight: 1.5 }}>{item.reason}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function WinnerBadge({ winner }: { winner: string }) {
  const PINK_LIGHT = "#ff4d96";
  const VIOLET = "#a259ff";
  const CYAN = "#40e8ff";

  if (winner === "a") {
    return <span style={{ display: "inline-flex", alignItems: "center", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 6, background: "rgba(255,20,100,0.15)", color: PINK_LIGHT }}>Gen A</span>;
  }
  if (winner === "b") {
    return <span style={{ display: "inline-flex", alignItems: "center", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 6, background: "rgba(162,89,255,0.15)", color: VIOLET }}>Gen B</span>;
  }
  return <span style={{ display: "inline-flex", alignItems: "center", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 6, background: "rgba(64,232,255,0.15)", color: CYAN }}>Blended</span>;
}

function ConfBadge({ conf }: { conf: string }) {
  const GREEN = "#3fffaa";
  const ORANGE = "#ff9f40";
  const PINK_LIGHT = "#ff4d96";

  if (conf === "high") {
    return <span style={{ display: "inline-flex", alignItems: "center", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 6, background: "rgba(63,255,170,0.12)", color: GREEN }}>High</span>;
  }
  if (conf === "low") {
    return <span style={{ display: "inline-flex", alignItems: "center", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 6, background: "rgba(255,77,150,0.15)", color: PINK_LIGHT }}>Low</span>;
  }
  return <span style={{ display: "inline-flex", alignItems: "center", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 6, background: "rgba(255,159,64,0.15)", color: ORANGE }}>Medium</span>;
}
