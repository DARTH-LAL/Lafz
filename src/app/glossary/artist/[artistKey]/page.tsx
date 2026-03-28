import { redirect } from "next/navigation";

import { AppTopBar } from "@/components/app-top-bar";
import { ArtistGlossaryCard } from "@/components/artist-glossary-card";
import { readArtistGlossaryFile, normalizeArtistKey } from "@/features/ai/glossary-repository";
import { buildLibraryQueue } from "@/features/library/queue";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type GlossaryArtistPageProps = {
  params: Promise<{ artistKey: string }>;
};

export default async function GlossaryArtistPage({ params }: GlossaryArtistPageProps) {
  const session = await readSpotifySessionFromCookies();
  if (!session) redirect("/login");

  const { artistKey } = await params;
  const [file, libraryQueue] = await Promise.all([
    readArtistGlossaryFile(artistKey),
    buildLibraryQueue(),
  ]);
  const artistName = file.displayName && file.displayName !== artistKey ? file.displayName : artistKey;

  // All library tracks whose artist key matches this glossary
  const artistTrackIds = libraryQueue.tracks
    .filter((t) => normalizeArtistKey(t.artist) === artistKey)
    .map((t) => t.spotify_track_id);

  return (
    <main className="relative min-h-screen w-full overflow-x-hidden bg-[#060410] text-[#fff0f6]">

      {/* Background glows */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -right-40 -top-40 h-[700px] w-[700px] rounded-full bg-[radial-gradient(circle,rgba(255,20,100,0.18)_0%,transparent_60%)]" />
        <div className="absolute -left-28 bottom-0 h-[450px] w-[500px] rounded-full bg-[radial-gradient(ellipse,rgba(160,20,255,0.10)_0%,transparent_65%)]" />
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

      <div className="relative z-10 mx-auto max-w-4xl px-6 py-8 lg:px-10">
        <AppTopBar connected className="mb-8" />

        {/* Back link + header */}
        <header className="mb-10">
          <a
            href="/library"
            className="mb-5 inline-flex items-center gap-2 text-[12px] font-semibold text-[rgba(255,20,100,0.65)] transition hover:text-[#ff6aaa]"
          >
            ← Back to library
          </a>
          <div className="flex items-center gap-3">
            <div className="h-0.5 w-7 rounded-full bg-[linear-gradient(90deg,#ff1464,transparent)] shadow-[0_0_8px_#ff1464]" />
            <p className="text-[11px] font-bold uppercase tracking-[2.5px] text-[#ff1464] [text-shadow:0_0_16px_rgba(255,20,100,0.6)]">
              Artist Glossary
            </p>
          </div>
          <h1 className="mt-3 text-[42px] font-extrabold leading-[1.04] tracking-[-2px]">
            {artistName}
          </h1>
          <p className="mt-2 text-[14px] text-[rgba(255,255,255,0.35)]">
            Terms and preferred renderings used when translating this artist&apos;s lyrics.
          </p>
          <div className="relative mt-6 h-px">
            <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(255,20,100,0.5)_30%,rgba(255,20,100,0.8)_50%,rgba(255,20,100,0.5)_70%,transparent)]" />
            <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#ff1464] shadow-[0_0_12px_#ff1464]" />
          </div>
        </header>

        {/* Glossary card */}
        <div className="rounded-[24px] border border-[rgba(255,20,100,0.12)] bg-[rgba(10,7,22,0.82)] p-6 backdrop-blur-[20px]">
          <ArtistGlossaryCard
            artistKey={artistKey}
            artistName={artistName}
            spotifyTrackIds={artistTrackIds}
          />
        </div>
      </div>
    </main>
  );
}
