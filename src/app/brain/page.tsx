import { redirect } from "next/navigation";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";
import { BrainClient } from "@/components/brain-client";
import { AnimatedBackground } from "@/components/animated-background";
import { AppTopBar } from "@/components/app-top-bar";

export const metadata = { title: "Lafz Brain" };

export default async function BrainPage() {
  const session = await readSpotifySessionFromCookies();
  if (!session) redirect("/login");

  return (
    <main className="relative min-h-screen w-full overflow-x-hidden text-[#fff0f6]">
      <AnimatedBackground />
      <div className="relative z-10 mx-auto max-w-6xl px-6 py-8 lg:px-10">
        <AppTopBar connected className="mb-8" />
        <BrainClient />
      </div>
    </main>
  );
}
