"use client";

import Image from "next/image";
import Link from "next/link";
import React, { useState } from "react";

import { BulkDeleteButton } from "@/components/bulk-delete-button";
import { DeleteTrackButton } from "@/components/delete-track-button";
import { TranslationStatusBadge } from "@/components/translation-status-badge";
import type { LibraryQueueRecord } from "@/features/library/types";
import { formatMilliseconds } from "@/lib/utils";

/* ─── helpers ──────────────────────────────────────────────────────────── */

function normalizeArtistKey(artist: string): string {
  return artist
    .split(/,|&| feat\.| ft\.| x /i)[0]
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatUpdatedAt(value: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleString();
}

/** Card art gradient — varies by status so each card looks distinct */
function artGradient(status: string) {
  switch (status) {
    case "synced":
      return "linear-gradient(145deg,#071a10 0%,#0b2b1a 50%,#071a12 100%)";
    case "unsynced":
      return "linear-gradient(145deg,#130c1e 0%,#1c0f30 50%,#0e0c24 100%)";
    case "needs_review":
      return "linear-gradient(145deg,#1a1200 0%,#2a1e00 50%,#1a1400 100%)";
    case "lyrics_ready":
      return "linear-gradient(145deg,#041820 0%,#062430 50%,#051a26 100%)";
    default: // needs_lyrics
      return "linear-gradient(145deg,#200608 0%,#300810 50%,#200608 100%)";
  }
}

/** Status ribbon config */
function ribbonConfig(status: string) {
  switch (status) {
    case "synced":
      return { label: "SYNCED", color: "#3fffaa", border: "rgba(63,255,170,0.35)", bg: "rgba(63,255,170,0.12)" };
    case "unsynced":
      return { label: "UNSYNCED", color: "#c87eff", border: "rgba(162,89,255,0.35)", bg: "rgba(162,89,255,0.12)" };
    case "needs_review":
      return { label: "NEEDS REVIEW", color: "#ffcc88", border: "rgba(255,179,71,0.35)", bg: "rgba(255,179,71,0.12)" };
    case "lyrics_ready":
      return { label: "LYRICS READY", color: "#40e8ff", border: "rgba(64,232,255,0.35)", bg: "rgba(64,232,255,0.12)" };
    default:
      return { label: "NEEDS LYRICS", color: "#ff9999", border: "rgba(255,70,70,0.32)", bg: "rgba(255,70,70,0.10)" };
  }
}

/** Per-status raw color for separator line */
function statusColor(status: string): string {
  switch (status) {
    case "synced":       return "rgba(63,255,170,0.70)";
    case "unsynced":     return "rgba(162,89,255,0.70)";
    case "needs_review": return "rgba(255,179,71,0.70)";
    case "lyrics_ready": return "rgba(64,232,255,0.70)";
    default:             return "rgba(255,70,70,0.70)";
  }
}

/** Per-status card border + glow */
function cardGlow(status: string): React.CSSProperties {
  switch (status) {
    case "synced":
      return {
        border: "1px solid rgba(63,255,170,0.40)",
        boxShadow: "0 0 0 1px rgba(63,255,170,0.10), 0 0 18px rgba(63,255,170,0.22), 0 0 50px rgba(63,255,170,0.08), 0 8px 32px rgba(0,0,0,0.55)"
      };
    case "unsynced":
      return {
        border: "1px solid rgba(162,89,255,0.40)",
        boxShadow: "0 0 0 1px rgba(162,89,255,0.10), 0 0 18px rgba(162,89,255,0.22), 0 0 50px rgba(162,89,255,0.08), 0 8px 32px rgba(0,0,0,0.55)"
      };
    case "needs_review":
      return {
        border: "1px solid rgba(255,179,71,0.40)",
        boxShadow: "0 0 0 1px rgba(255,179,71,0.10), 0 0 18px rgba(255,179,71,0.22), 0 0 50px rgba(255,179,71,0.08), 0 8px 32px rgba(0,0,0,0.55)"
      };
    case "lyrics_ready":
      return {
        border: "1px solid rgba(64,232,255,0.36)",
        boxShadow: "0 0 0 1px rgba(64,232,255,0.08), 0 0 18px rgba(64,232,255,0.20), 0 0 50px rgba(64,232,255,0.07), 0 8px 32px rgba(0,0,0,0.55)"
      };
    default: // needs_lyrics
      return {
        border: "1px solid rgba(255,70,70,0.36)",
        boxShadow: "0 0 0 1px rgba(255,70,70,0.08), 0 0 18px rgba(255,70,70,0.20), 0 0 50px rgba(255,70,70,0.07), 0 8px 32px rgba(0,0,0,0.55)"
      };
  }
}

/** Translation progress bar fill colour + pct */
function progressConfig(record: LibraryQueueRecord) {
  if (record.studio_status === "synced") {
    return { pct: 100, color: "#3fffaa", glow: "rgba(63,255,170,0.45)" };
  }
  if (record.studio_status === "unsynced") {
    return { pct: 100, color: "#c87eff", glow: "rgba(162,89,255,0.45)" };
  }
  if (record.ai_draft_exists) {
    const pct = Math.round((record.review_completion_ratio ?? 0) * 100);
    return { pct: Math.max(pct, 8), color: "#ffcc88", glow: "rgba(255,179,71,0.35)" };
  }
  if (record.studio_status === "lyrics_ready") {
    return { pct: 8, color: "#40e8ff", glow: "rgba(64,232,255,0.35)" };
  }
  return { pct: 0, color: "#ff9999", glow: "" };
}

/* ─── Music note placeholder ────────────────────────────────────────────── */
function MusicNote({ opacity = 0.18 }: { opacity?: number }) {
  return (
    <svg
      viewBox="0 0 40 40"
      className="h-10 w-10"
      style={{ opacity }}
      aria-hidden="true"
      fill="white"
    >
      <path d="M14 30c0 2.2-1.8 4-4 4s-4-1.8-4-4 1.8-4 4-4 4 1.8 4 4zm18-6c0 2.2-1.8 4-4 4s-4-1.8-4-4 1.8-4 4-4 4 1.8 4 4zm-18 0V10l18-4v14" />
    </svg>
  );
}

/* ─── Grid card ─────────────────────────────────────────────────────────── */
function SongCard({ record, artUrl }: { record: LibraryQueueRecord; artUrl?: string | null }) {
  const ribbon = ribbonConfig(record.studio_status);
  const progress = progressConfig(record);
  const playlist = record.source_playlists[0];
  const resolvedArt = artUrl ?? null;

  const glow = cardGlow(record.studio_status);

  return (
    <div
      className="group relative flex flex-col overflow-hidden rounded-[20px] bg-[rgba(6,2,5,0.92)] transition-all duration-200 hover:-translate-y-1"
      style={glow}
    >

      {/* Art area */}
      <div
        className="relative flex h-[168px] w-full items-center justify-center overflow-hidden"
        style={{ background: artGradient(record.studio_status) }}
      >
        {resolvedArt ? (
          <Image
            src={resolvedArt}
            alt={`${record.album} cover`}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            className="object-cover opacity-90 transition-transform duration-300 group-hover:scale-105"
            unoptimized
          />
        ) : (
          <MusicNote opacity={0.14} />
        )}

        {/* Subtle dark overlay so ribbon/icons stay readable */}
        {resolvedArt && (
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.18)_0%,rgba(0,0,0,0.05)_40%,rgba(0,0,0,0.35)_100%)]" />
        )}

        {/* Status ribbon */}
        <div
          className="absolute right-3 top-3 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[1.4px]"
          style={{ color: ribbon.color, border: `1px solid ${ribbon.border}`, background: ribbon.bg }}
        >
          {ribbon.label}
        </div>

        {/* Delete icon — visible on hover */}
        <div className="absolute left-3 top-3 opacity-0 transition-opacity group-hover:opacity-100">
          <DeleteTrackButton spotifyTrackId={record.spotify_track_id} trackTitle={record.title} />
        </div>
      </div>

      {/* Glow separator */}
      <div
        className="h-px w-full flex-shrink-0"
        style={{
          background: `linear-gradient(90deg, transparent 0%, ${statusColor(record.studio_status)} 50%, transparent 100%)`,
          boxShadow: `0 0 8px 2px ${statusColor(record.studio_status)}`
        }}
      />

      {/* Card body */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* Playlist chip */}
        {playlist && (
          <span className="inline-block w-fit rounded-full border border-[rgba(255,20,100,0.18)] bg-[rgba(255,20,100,0.07)] px-2.5 py-0.5 text-[10px] font-semibold text-[#ff6aaa]">
            {playlist.playlist_name}
          </span>
        )}

        {/* Title + artist */}
        <div>
          <p className="line-clamp-1 font-display text-[14px] font-semibold text-[#fff0f6] transition-colors group-hover:text-[#ffb0d0]">
            {record.title}
          </p>
          <Link
            href={`/glossary/artist/${normalizeArtistKey(record.artist)}`}
            onClick={(e) => e.stopPropagation()}
            className="mt-0.5 line-clamp-1 block text-[12px] text-[rgba(255,20,100,0.65)] hover:text-[#ff1464] hover:underline"
          >{record.artist}</Link>
        </div>

        {/* Translation progress bar */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[1px] text-[rgba(255,255,255,0.3)]">
              Translation
            </span>
            <span className="text-[10px] font-bold" style={{ color: progress.pct > 0 ? ribbon.color : "rgba(255,255,255,0.2)" }}>
              {progress.pct}%
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
            {progress.pct > 0 && (
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progress.pct}%`,
                  background: progress.color,
                  boxShadow: `0 0 8px ${progress.glow}`
                }}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-auto flex items-center justify-between pt-1">
          <span className="text-[11px] text-[rgba(255,255,255,0.25)]">
            {formatMilliseconds(record.duration_ms)}
          </span>
          <Link
            href={`/library/track/${record.spotify_track_id}`}
            className="inline-flex items-center justify-center rounded-full border border-[rgba(255,20,100,0.28)] bg-[rgba(255,20,100,0.10)] px-4 py-1.5 text-[11px] font-bold text-[#ff6aaa] transition hover:bg-[rgba(255,20,100,0.25)] hover:text-white hover:shadow-[0_0_16px_rgba(255,20,100,0.35)]"
          >
            Open
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ─── List row ──────────────────────────────────────────────────────────── */
function ListRow({ record }: { record: LibraryQueueRecord }) {
  return (
    <tr
      className="group border-b border-[rgba(255,255,255,0.04)] bg-[rgba(6,4,16,0.65)] align-top transition-all last:border-b-0 hover:bg-[rgba(255,20,100,0.05)] [border-left:3px_solid_transparent] hover:[border-left-color:#ff1464]"
    >
      <td className="px-6 py-5">
        <p className="font-display text-[15px] font-semibold text-[#fff0f6] transition-colors group-hover:text-[#ffb0d0]">
          {record.title}
        </p>
        <Link
          href={`/glossary/artist/${normalizeArtistKey(record.artist)}`}
          onClick={(e) => e.stopPropagation()}
          className="mt-1 block text-[13px] text-[rgba(255,20,100,0.65)] hover:text-[#ff1464] hover:underline"
        >{record.artist}</Link>
        <p className="mt-1 text-[11px] text-white">{record.album} · {formatMilliseconds(record.duration_ms)}</p>
      </td>
      <td className="px-6 py-5">
        <p className="text-[13px] capitalize text-white">{record.language}</p>
      </td>
      <td className="px-6 py-5">
        <TranslationStatusBadge status={record.studio_status} />
        {!record.translation_file_exists && record.ai_draft_exists ? (
          <p className="mt-2 text-[11px] leading-5 text-[#ff6aaa]">
            AI draft: {record.ai_draft_line_count} lines ({record.ai_draft_mode})
          </p>
        ) : null}
      </td>
      <td className="px-6 py-5">
        <div className="flex flex-wrap gap-1.5">
          {record.source_playlists.map((playlist) => (
            <span
              key={`${record.spotify_track_id}-${playlist.playlist_id}`}
              className="rounded-full border border-[rgba(255,20,100,0.16)] bg-[rgba(255,20,100,0.06)] px-3 py-1 text-[11px] text-[#ff6aaa]"
            >
              {playlist.playlist_name}
            </span>
          ))}
        </div>
        {formatUpdatedAt(record.translation_last_modified_at) ? (
          <p className="mt-2 text-[11px] text-white">{formatUpdatedAt(record.translation_last_modified_at)}</p>
        ) : null}
      </td>
      <td className="px-6 py-5">
        <div className="flex items-center gap-2">
          <Link
            href={`/library/track/${record.spotify_track_id}`}
            className="inline-flex items-center justify-center rounded-full border border-[rgba(255,20,100,0.25)] bg-[rgba(255,20,100,0.10)] px-5 py-2 text-[12px] font-semibold text-[#ff6aaa] transition hover:bg-[rgba(255,20,100,0.22)] hover:text-[#fff0f6] hover:shadow-[0_0_20px_rgba(255,20,100,0.35)]"
          >
            Open
          </Link>
          <DeleteTrackButton
            spotifyTrackId={record.spotify_track_id}
            trackTitle={record.title}
          />
        </div>
      </td>
    </tr>
  );
}

/* ─── Toggle button ─────────────────────────────────────────────────────── */
function ViewToggle({ view, onChange }: { view: "grid" | "list"; onChange: (v: "grid" | "list") => void }) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-full p-1"
      style={{
        border: "1px solid rgba(255,20,100,0.40)",
        background: "rgba(6,2,5,0.92)",
        boxShadow: "0 0 0 1px rgba(255,20,100,0.10), 0 0 12px rgba(255,20,100,0.25), 0 0 28px rgba(255,20,100,0.10)"
      }}
    >
      {/* Grid */}
      <button
        onClick={() => onChange("grid")}
        title="Grid view"
        className="inline-flex items-center justify-center rounded-full p-2 transition"
        style={view === "grid" ? {
          background: "linear-gradient(135deg,#ff1464,#ff6aaa)",
          color: "#fff",
          boxShadow: "0 0 14px rgba(255,20,100,0.55)"
        } : { color: "rgba(255,255,255,0.50)" }}
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden="true">
          <rect x="1" y="1" width="6" height="6" rx="1.2" />
          <rect x="9" y="1" width="6" height="6" rx="1.2" />
          <rect x="1" y="9" width="6" height="6" rx="1.2" />
          <rect x="9" y="9" width="6" height="6" rx="1.2" />
        </svg>
      </button>
      {/* List */}
      <button
        onClick={() => onChange("list")}
        title="List view"
        className="inline-flex items-center justify-center rounded-full p-2 transition"
        style={view === "list" ? {
          background: "linear-gradient(135deg,#ff1464,#ff6aaa)",
          color: "#fff",
          boxShadow: "0 0 14px rgba(255,20,100,0.55)"
        } : { color: "rgba(255,255,255,0.50)" }}
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4 fill-current" aria-hidden="true">
          <rect x="1" y="2" width="14" height="2.2" rx="1.1" />
          <rect x="1" y="6.9" width="14" height="2.2" rx="1.1" />
          <rect x="1" y="11.8" width="14" height="2.2" rx="1.1" />
        </svg>
      </button>
    </div>
  );
}

/* ─── Main client component ─────────────────────────────────────────────── */
export function LibraryQueueClient({
  records,
  artMap = {}
}: {
  records: LibraryQueueRecord[];
  artMap?: Record<string, string | null>;
}) {
  const [view, setView] = useState<"grid" | "list">("grid");

  const needsLyricsIds = records
    .filter((r) => r.studio_status === "needs_lyrics")
    .map((r) => r.spotify_track_id);

  return (
    <>
      {/* Toolbar: bulk delete + view toggle */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          {needsLyricsIds.length > 0 && (
            <BulkDeleteButton spotifyTrackIds={needsLyricsIds} label="Delete all — Needs Lyrics" />
          )}
        </div>
        <ViewToggle view={view} onChange={setView} />
      </div>

      {/* Grid view */}
      {view === "grid" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {records.map((record) => (
            <SongCard
              key={record.spotify_track_id}
              record={record}
              artUrl={artMap[record.spotify_track_id] ?? record.album_art_url}
            />
          ))}
        </div>
      )}

      {/* List view */}
      {view === "list" && (
        <section className="overflow-hidden lafz-card">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="border-b border-[rgba(255,20,100,0.12)] bg-[rgba(255,20,100,0.05)] text-[10px] font-bold uppercase tracking-[2px] text-[rgba(255,20,100,0.65)]">
                  <th className="px-6 py-4">Track</th>
                  <th className="px-6 py-4">Language</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4">Playlist</th>
                  <th className="px-6 py-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <ListRow key={record.spotify_track_id} record={record} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
