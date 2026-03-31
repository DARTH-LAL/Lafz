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
    <div className="relative min-h-screen">
      <AnimatedBackground />
      <div className="relative z-10 flex min-h-screen flex-col">
        <div className="px-4 pt-4">
          <AppTopBar connected />
        </div>
        <div className="flex flex-1 flex-col px-4 pb-4 pt-4">
          <BrainClient />
        </div>
      </div>
    </div>
  );
}
