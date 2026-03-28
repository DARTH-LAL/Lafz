import { redirect } from "next/navigation";

import { AnimatedBackground } from "@/components/animated-background";
import { AppTopBar } from "@/components/app-top-bar";
import { TranslationEditor } from "@/components/translation-editor";
import { VersionHistory } from "@/components/version-history";
import { getAiTranslationDraftByTrackId, inspectAiTranslationDraftFile } from "@/features/ai/repository";
import { getLibraryTrackRecord } from "@/features/library/queue";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ReviewPageProps = {
  params: Promise<{ spotifyTrackId: string }>;
};

export default async function DraftReviewPage({ params }: ReviewPageProps) {
  const session = await readSpotifySessionFromCookies();
  if (!session) redirect("/login");

  const { spotifyTrackId } = await params;
  const [{ record }, aiDraftInspection, aiDraft] = await Promise.all([
    getLibraryTrackRecord(spotifyTrackId),
    inspectAiTranslationDraftFile(spotifyTrackId),
    getAiTranslationDraftByTrackId(spotifyTrackId)
  ]);

  return (
    <main className="relative min-h-screen w-full overflow-x-hidden text-[#fff0f6]">
      <AnimatedBackground />
      <div className="relative z-10 mx-auto max-w-6xl px-6 py-8 lg:px-10">
        <AppTopBar connected className="mb-8" />

        {/* Back link + track info */}
        <header className="mb-10">
          <a
            href={`/library/track/${spotifyTrackId}`}
            className="mb-5 inline-flex items-center gap-2 text-[12px] font-semibold text-[rgba(255,20,100,0.65)] transition hover:text-[#ff6aaa]"
          >
            ← Back to track
          </a>
          <div className="flex items-center gap-3">
            <div className="h-0.5 w-7 rounded-full bg-[linear-gradient(90deg,#ff1464,transparent)] shadow-[0_0_8px_#ff1464]" />
            <p className="text-[11px] font-bold uppercase tracking-[2.5px] text-[#ff1464] [text-shadow:0_0_16px_rgba(255,20,100,0.6)]">
              Draft Review
            </p>
          </div>
          {record && (
            <>
              <h1 className="mt-3 text-[42px] font-extrabold leading-[1.04] tracking-[-2px] text-white [text-shadow:0_0_30px_rgba(255,255,255,0.30),0_0_70px_rgba(255,255,255,0.12)]">{record.title}</h1>
              <p className="mt-2 text-[16px] text-white [text-shadow:0_0_16px_rgba(255,255,255,0.55),0_0_40px_rgba(255,255,255,0.20)]">{record.artist}</p>
            </>
          )}
          <div className="mt-4 flex justify-end">
            <VersionHistory
              spotifyTrackId={spotifyTrackId}
              currentGeneratedAt={aiDraftInspection.lastModifiedAt}
            />
          </div>
        </header>

        <div className="lafz-card p-6">
          <TranslationEditor
            track={{
              spotifyTrackId,
              title: record?.title ?? "",
              artist: record?.artist ?? "",
            }}
            initialDraft={aiDraft}
            lastModifiedAt={aiDraftInspection.lastModifiedAt}
          />
        </div>
      </div>
    </main>
  );
}
