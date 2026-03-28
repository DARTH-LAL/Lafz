import { AppTopBar } from "@/components/app-top-bar";
import { LibraryQueueClient } from "@/components/library-queue-client";
import { StatePanel } from "@/components/state-panel";
import type { LibraryQueueFilters, LibraryQueueRecord, LibraryQueueResult } from "@/features/library/types";

type LibraryQueueViewProps = {
  queue: LibraryQueueResult;
  records: LibraryQueueRecord[];
  filters: LibraryQueueFilters;
  artMap?: Record<string, string | null>;
};

export function LibraryQueueView({ queue, records, filters, artMap }: LibraryQueueViewProps) {
  return (
    <main className="relative min-h-screen w-full overflow-x-hidden bg-[#060410] text-[#fff0f6]">

      {/* Background glows */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -right-40 -top-40 h-[700px] w-[700px] rounded-full bg-[radial-gradient(circle,rgba(255,20,100,0.18)_0%,transparent_60%)]" />
        <div className="absolute -left-28 bottom-0 h-[500px] w-[600px] rounded-full bg-[radial-gradient(ellipse,rgba(255,0,100,0.10)_0%,transparent_65%)]" />
      </div>

      {/* Dot grid */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: "radial-gradient(rgba(255,20,100,0.10) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%)"
        }}
      />

      <div className="relative z-10 mx-auto max-w-7xl px-6 py-8 lg:px-10">
        <AppTopBar connected className="mb-8" />

        {/* Header */}
        <header className="mb-10 pb-8">
          <div className="mb-4 flex items-center gap-3">
            <div className="h-0.5 w-7 rounded-full bg-[linear-gradient(90deg,#ff1464,transparent)] shadow-[0_0_8px_#ff1464]" />
            <p className="text-[11px] font-bold uppercase tracking-[2.5px] text-[#ff1464] [text-shadow:0_0_16px_rgba(255,20,100,0.6)]">
              Lafz Library Queue
            </p>
          </div>
          <h1 className="font-display text-5xl font-extrabold leading-[1.04] tracking-[-2.2px] text-[#fff0f6]">
            Translation work across
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage: "linear-gradient(110deg,#ff1464 0%,#ff6aaa 25%,#ffffff 48%,#ff6aaa 68%,#ff1464 100%)",
                backgroundSize: "250% 100%",
                animation: "lafz-shimmer 3.5s linear infinite"
              }}
            >
              all imported playlists.
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-[1.7] text-[#7a6890]">
            Your full translation queue — filter by status, language, or playlist and pick up exactly where you left off.
          </p>

          {/* Glowing divider */}
          <div className="relative mt-8 h-px w-full">
            <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(255,20,100,0.5)_30%,rgba(255,20,100,0.8)_50%,rgba(255,20,100,0.5)_70%,transparent)] shadow-[0_0_12px_rgba(255,20,100,0.3)]" />
            <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ff1464] shadow-[0_0_12px_#ff1464,0_0_24px_rgba(255,20,100,0.6)]" />
          </div>
        </header>

        {/* Stats */}
        <section className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/* Violet */}
          <div className="group relative overflow-hidden rounded-[22px] border border-[rgba(160,60,255,0.28)] bg-[linear-gradient(135deg,rgba(160,60,255,0.13)_0%,rgba(160,60,255,0.04)_100%)] p-6 shadow-[0_0_40px_rgba(160,60,255,0.08)_inset] backdrop-blur-xl transition-transform hover:-translate-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[2px] text-[rgba(180,100,255,0.65)]">Total Unique Tracks</p>
            <p className="mt-3 text-[44px] font-extrabold leading-none tracking-[-2px] text-[#c87eff] [text-shadow:0_0_30px_rgba(160,60,255,0.55)]">
              {queue.summary.total_unique_tracks}
            </p>
          </div>

          {/* Pink */}
          <div className="group relative overflow-hidden rounded-[22px] border border-[rgba(255,20,100,0.28)] bg-[linear-gradient(135deg,rgba(255,20,100,0.13)_0%,rgba(255,20,100,0.04)_100%)] p-6 shadow-[0_0_40px_rgba(255,20,100,0.08)_inset] backdrop-blur-xl transition-transform hover:-translate-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[2px] text-[rgba(255,80,140,0.65)]">Needs Review</p>
            <p className="mt-3 text-[44px] font-extrabold leading-none tracking-[-2px] text-[#ff4d96] [text-shadow:0_0_30px_rgba(255,20,100,0.55)]">
              {queue.summary.needs_review}
            </p>
          </div>

          {/* Cyan */}
          <div className="group relative overflow-hidden rounded-[22px] border border-[rgba(0,220,255,0.22)] bg-[linear-gradient(135deg,rgba(0,220,255,0.10)_0%,rgba(0,220,255,0.03)_100%)] p-6 shadow-[0_0_40px_rgba(0,220,255,0.06)_inset] backdrop-blur-xl transition-transform hover:-translate-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[2px] text-[rgba(0,200,240,0.65)]">Needs Lyrics</p>
            <p className="mt-3 text-[44px] font-extrabold leading-none tracking-[-2px] text-[#40e8ff] [text-shadow:0_0_30px_rgba(0,220,255,0.50)]">
              {queue.summary.needs_lyrics}
            </p>
          </div>

          {/* Green */}
          <div className="group relative overflow-hidden rounded-[22px] border border-[rgba(30,255,140,0.20)] bg-[linear-gradient(135deg,rgba(30,255,140,0.10)_0%,rgba(30,255,140,0.03)_100%)] p-6 shadow-[0_0_40px_rgba(30,255,140,0.06)_inset] backdrop-blur-xl transition-transform hover:-translate-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[2px] text-[rgba(30,220,120,0.65)]">Synced</p>
            <p className="mt-3 text-[44px] font-extrabold leading-none tracking-[-2px] text-[#3fffaa] [text-shadow:0_0_30px_rgba(30,255,140,0.50)]">
              {queue.summary.synced}
            </p>
          </div>
        </section>

        {/* Filter bar */}
        <section className="mb-6 rounded-[24px] border border-[rgba(255,20,100,0.14)] bg-[rgba(10,7,22,0.92)] p-6 shadow-[0_0_60px_rgba(255,20,100,0.05)] backdrop-blur-[28px]">
          <form className="grid gap-4 lg:grid-cols-[minmax(240px,2fr)_repeat(4,minmax(0,1fr))] lg:items-end">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(255,20,100,0.65)]">Search</span>
              <input
                type="search"
                name="q"
                defaultValue={filters.search}
                placeholder="Title, artist, album, playlist..."
                className="mt-2 w-full rounded-[12px] border border-[rgba(255,20,100,0.14)] bg-[rgba(255,20,100,0.05)] px-4 py-2.5 text-sm text-white outline-none transition placeholder:text-[#5a4870] focus:border-[rgba(255,20,100,0.50)] focus:shadow-[0_0_0_3px_rgba(255,20,100,0.10)]"
              />
            </label>

            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(255,20,100,0.65)]">Status</span>
              <select
                name="status"
                defaultValue={filters.status}
                className="mt-2 w-full rounded-[12px] border border-[rgba(255,20,100,0.14)] bg-[rgba(255,20,100,0.05)] px-4 py-2.5 text-sm text-white outline-none transition focus:border-[rgba(255,20,100,0.50)]"
              >
                <option value="all">All statuses</option>
                <option value="needs_lyrics">Needs lyrics</option>
                <option value="lyrics_ready">Lyrics ready</option>
                <option value="needs_review">Needs review</option>
                <option value="reviewed">Reviewed</option>
                <option value="synced">Synced</option>
                <option value="published">Published</option>
              </select>
            </label>

            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(255,20,100,0.65)]">Language</span>
              <select
                name="language"
                defaultValue={filters.language || "all"}
                className="mt-2 w-full rounded-[12px] border border-[rgba(255,20,100,0.14)] bg-[rgba(255,20,100,0.05)] px-4 py-2.5 text-sm text-white outline-none transition focus:border-[rgba(255,20,100,0.50)]"
              >
                <option value="all">All languages</option>
                {queue.filterOptions.languages.map((language) => (
                  <option key={language} value={language}>{language}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(255,20,100,0.65)]">Playlist</span>
              <select
                name="playlist"
                defaultValue={filters.playlist || "all"}
                className="mt-2 w-full rounded-[12px] border border-[rgba(255,20,100,0.14)] bg-[rgba(255,20,100,0.05)] px-4 py-2.5 text-sm text-white outline-none transition focus:border-[rgba(255,20,100,0.50)]"
              >
                <option value="all">All playlists</option>
                {queue.filterOptions.playlists.map((playlist) => (
                  <option key={playlist.playlist_id} value={playlist.playlist_id}>{playlist.playlist_name}</option>
                ))}
              </select>
            </label>

            <div className="flex items-end gap-3">
              <label className="block flex-1">
                <span className="text-[10px] font-bold uppercase tracking-[1.8px] text-[rgba(255,20,100,0.65)]">Sort</span>
                <select
                  name="sort"
                  defaultValue={filters.sort}
                  className="mt-2 w-full rounded-[12px] border border-[rgba(255,20,100,0.14)] bg-[rgba(255,20,100,0.05)] px-4 py-2.5 text-sm text-white outline-none transition focus:border-[rgba(255,20,100,0.50)]"
                >
                  <option value="status">Status</option>
                  <option value="title">Title</option>
                  <option value="artist">Artist</option>
                  <option value="recently_updated">Recently updated</option>
                </select>
              </label>
              <button
                type="submit"
                className="inline-flex h-[42px] items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff1464,#ff6aaa)] px-6 text-sm font-bold text-white shadow-[0_0_24px_rgba(255,20,100,0.40)] transition hover:opacity-88 hover:shadow-[0_0_36px_rgba(255,20,100,0.60)]"
              >
                Apply
              </button>
            </div>
          </form>

          <p className="mt-4 text-xs text-[#5a4870]">
            Showing {records.length} track{records.length === 1 ? "" : "s"} from {queue.summary.total_unique_tracks} unique imported song{queue.summary.total_unique_tracks === 1 ? "" : "s"}.
          </p>
        </section>

        {queue.warnings.length > 0 ? (
          <div className="mb-6 rounded-[24px] border border-amber-300/20 bg-amber-300/10 p-5 text-sm text-amber-100">
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

        {/* Track grid / list */}
        {records.length === 0 ? (
          <StatePanel
            eyebrow="No matches"
            title="No tracks match the current queue filters"
            description="Try widening your search, changing the status filter, or importing more playlists into Lafz first."
          />
        ) : (
          <LibraryQueueClient records={records} artMap={artMap} />
        )}
      </div>

      <style>{`
        @keyframes lafz-shimmer { to { background-position: -250% 0; } }
      `}</style>
    </main>
  );
}
