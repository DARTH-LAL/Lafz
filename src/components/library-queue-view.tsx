import Link from "next/link";

import { StatePanel } from "@/components/state-panel";
import { TranslationStatusBadge } from "@/components/translation-status-badge";
import type { LibraryQueueFilters, LibraryQueueRecord, LibraryQueueResult } from "@/features/library/types";
import { formatMilliseconds } from "@/lib/utils";

function formatUpdatedAt(value: string | null) {
  if (!value) {
    return "Not updated yet";
  }

  return new Date(value).toLocaleString();
}

type LibraryQueueViewProps = {
  queue: LibraryQueueResult;
  records: LibraryQueueRecord[];
  filters: LibraryQueueFilters;
};

export function LibraryQueueView({ queue, records, filters }: LibraryQueueViewProps) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-6 py-8 lg:px-10">
      <header className="mb-8 flex flex-col gap-4 border-b border-white/8 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300/80">Lafz library queue</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Translation work across all imported playlists.
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-400">
            Lafz reads every local playlist file, merges duplicate songs by Spotify track ID, inspects local translation
            files, and builds a practical queue so you can focus on Punjabi, Hindi, and Urdu translation work.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/library/import"
            className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
          >
            Import playlists
          </Link>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full border border-white/12 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
          >
            Back to now playing
          </Link>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[24px] border border-white/8 bg-[color:var(--lafz-panel)] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Total unique tracks</p>
          <p className="mt-3 text-3xl font-semibold text-white">{queue.summary.total_unique_tracks}</p>
        </div>
        <div className="rounded-[24px] border border-amber-300/15 bg-amber-300/8 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
          <p className="text-xs uppercase tracking-[0.24em] text-amber-100/70">Pending</p>
          <p className="mt-3 text-3xl font-semibold text-white">{queue.summary.pending}</p>
        </div>
        <div className="rounded-[24px] border border-cyan-300/15 bg-cyan-300/8 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
          <p className="text-xs uppercase tracking-[0.24em] text-cyan-100/70">Stub</p>
          <p className="mt-3 text-3xl font-semibold text-white">{queue.summary.stub}</p>
        </div>
        <div className="rounded-[24px] border border-emerald-300/15 bg-emerald-300/8 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.22)] backdrop-blur-xl">
          <p className="text-xs uppercase tracking-[0.24em] text-emerald-100/70">Translated</p>
          <p className="mt-3 text-3xl font-semibold text-white">{queue.summary.translated}</p>
        </div>
      </section>

      <section className="mt-6 rounded-[32px] border border-white/10 bg-[color:var(--lafz-panel)] p-6 shadow-[0_24px_100px_rgba(0,0,0,0.3)] backdrop-blur-xl">
        <form className="grid gap-4 lg:grid-cols-[minmax(240px,2fr)_repeat(4,minmax(0,1fr))] lg:items-end">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Search</span>
            <input
              type="search"
              name="q"
              defaultValue={filters.search}
              placeholder="Title, artist, album, playlist..."
              className="mt-3 w-full rounded-[18px] border border-white/12 bg-black/20 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/50"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Status</span>
            <select
              name="status"
              defaultValue={filters.status}
              className="mt-3 w-full rounded-[18px] border border-white/12 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="stub">Stub</option>
              <option value="translated">Translated</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Language</span>
            <select
              name="language"
              defaultValue={filters.language || "all"}
              className="mt-3 w-full rounded-[18px] border border-white/12 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
            >
              <option value="all">All languages</option>
              {queue.filterOptions.languages.map((language) => (
                <option key={language} value={language}>
                  {language}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Playlist</span>
            <select
              name="playlist"
              defaultValue={filters.playlist || "all"}
              className="mt-3 w-full rounded-[18px] border border-white/12 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
            >
              <option value="all">All playlists</option>
              {queue.filterOptions.playlists.map((playlist) => (
                <option key={playlist.playlist_id} value={playlist.playlist_id}>
                  {playlist.playlist_name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Sort</span>
              <select
                name="sort"
                defaultValue={filters.sort}
                className="mt-3 w-full rounded-[18px] border border-white/12 bg-black/20 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-300/50"
              >
                <option value="status">Status</option>
                <option value="title">Title</option>
                <option value="artist">Artist</option>
                <option value="recently_updated">Recently updated</option>
              </select>
            </label>
            <button
              type="submit"
              className="mt-[1.6rem] inline-flex h-[46px] items-center justify-center rounded-full bg-cyan-300 px-5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
            >
              Apply
            </button>
          </div>
        </form>

        <div className="mt-4 text-sm text-slate-400">
          Showing {records.length} track{records.length === 1 ? "" : "s"} from {queue.summary.total_unique_tracks} unique imported song{queue.summary.total_unique_tracks === 1 ? "" : "s"}.
        </div>
      </section>

      {queue.warnings.length > 0 ? (
        <div className="mt-6 rounded-[28px] border border-amber-300/20 bg-amber-300/10 p-5 text-sm text-amber-100">
          <p className="font-semibold">Some playlist files were skipped because they could not be parsed cleanly.</p>
          <div className="mt-3 space-y-2">
            {queue.warnings.map((warning) => (
              <p key={`${warning.source}-${warning.message}`}>
                <span className="font-mono text-xs">{warning.source}</span>: {warning.message}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {records.length === 0 ? (
        <div className="mt-6">
          <StatePanel
            eyebrow="No matches"
            title="No tracks match the current queue filters"
            description="Try widening your search, changing the status filter, or importing more playlists into Lafz first."
          />
        </div>
      ) : (
        <section className="mt-6 overflow-hidden rounded-[32px] border border-white/10 bg-[color:var(--lafz-panel)] shadow-[0_24px_100px_rgba(0,0,0,0.3)] backdrop-blur-xl">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-white/8 text-left">
              <thead className="bg-white/[0.03] text-xs uppercase tracking-[0.22em] text-slate-500">
                <tr>
                  <th className="px-5 py-4">Track</th>
                  <th className="px-5 py-4">Language</th>
                  <th className="px-5 py-4">Status</th>
                  <th className="px-5 py-4">Playlists</th>
                  <th className="px-5 py-4">Translation file</th>
                  <th className="px-5 py-4">Updated</th>
                  <th className="px-5 py-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/6 text-sm text-slate-200">
                {records.map((record) => (
                  <tr key={record.spotify_track_id} className="align-top">
                    <td className="px-5 py-5">
                      <p className="font-display text-xl text-white">{record.title}</p>
                      <p className="mt-1 text-slate-300">{record.artist}</p>
                      <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-500">{record.album}</p>
                      <p className="mt-2 text-xs text-slate-500">{formatMilliseconds(record.duration_ms)}</p>
                    </td>
                    <td className="px-5 py-5">
                      <p className="capitalize text-white">{record.language}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        Library status: {record.explicit_translation_status ?? "pending"}
                      </p>
                    </td>
                    <td className="px-5 py-5">
                      <TranslationStatusBadge status={record.derived_status} />
                      {record.translation_parse_error ? (
                        <p className="mt-3 max-w-[16rem] text-xs leading-6 text-amber-200">
                          Translation JSON needs attention: {record.translation_parse_error}
                        </p>
                      ) : null}
                      {!record.translation_file_exists && record.ai_draft_exists ? (
                        <p className="mt-3 max-w-[16rem] text-xs leading-6 text-cyan-200">
                          AI draft ready: {record.ai_draft_line_count} line{record.ai_draft_line_count === 1 ? "" : "s"} ({record.ai_draft_mode})
                        </p>
                      ) : null}
                      {record.translation_file_exists && record.translation_line_count === 0 && record.ai_draft_exists ? (
                        <p className="mt-3 max-w-[16rem] text-xs leading-6 text-cyan-200">
                          Stub file is present, and a separate AI draft is ready for review.
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-5">
                      <div className="flex max-w-[18rem] flex-wrap gap-2">
                        {record.source_playlists.map((playlist) => (
                          <span
                            key={`${record.spotify_track_id}-${playlist.playlist_id}`}
                            className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-300"
                          >
                            {playlist.playlist_name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-5">
                      <p className="text-white">{record.translation_file_exists ? "Present" : "Missing"}</p>
                      <p className="mt-2 text-xs text-slate-500">{record.translation_line_count} line{record.translation_line_count === 1 ? "" : "s"}</p>
                      {record.ai_draft_exists ? (
                        <p className="mt-2 text-xs text-slate-400">
                          Draft: {record.ai_draft_line_count} line{record.ai_draft_line_count === 1 ? "" : "s"} via {record.ai_draft_model ?? "AI"}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-5 py-5 text-slate-400">{formatUpdatedAt(record.translation_last_modified_at)}</td>
                    <td className="px-5 py-5">
                      <Link
                        href={`/library/track/${record.spotify_track_id}`}
                        className="inline-flex items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/15"
                      >
                        Open track
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
