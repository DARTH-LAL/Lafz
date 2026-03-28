import { redirect } from "next/navigation";

import { AnimatedBackground } from "@/components/animated-background";
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
    <main className="relative min-h-screen w-full overflow-x-hidden text-[#fff0f6]">
      <AnimatedBackground />
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
          <h1 className="mt-3 text-[42px] font-extrabold leading-[1.04] tracking-[-2px] text-white [text-shadow:0_0_30px_rgba(255,255,255,0.30),0_0_70px_rgba(255,255,255,0.12)]">
            {artistName}
          </h1>
          <p className="mt-2 text-[14px] text-white [text-shadow:0_0_16px_rgba(255,255,255,0.55),0_0_40px_rgba(255,255,255,0.20)]">
            Terms and preferred renderings used when translating this artist&apos;s lyrics.
          </p>
        </header>

        {/* Glossary card */}
        <div className="lafz-card p-6">
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
