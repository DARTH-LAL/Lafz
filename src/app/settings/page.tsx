import { redirect } from "next/navigation";
import { AnimatedBackground } from "@/components/animated-background";
import { AppTopBar } from "@/components/app-top-bar";
import { SettingsClient } from "@/components/settings-client";
import { readSettings } from "@/features/settings/repository";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function SettingsPage() {
  const session = await readSpotifySessionFromCookies();
  if (!session) redirect("/login");

  const settings = await readSettings();
  const tokenExpiresInMs = session.expiresAt - Date.now();
  const tokenExpiresInMin = Math.max(0, Math.floor(tokenExpiresInMs / 60000));

  return (
    <main className="relative min-h-screen w-full overflow-x-hidden text-[#fff0f6]">
      <AnimatedBackground />
      <div className="relative z-10 mx-auto max-w-6xl px-6 py-8 lg:px-10">
        <AppTopBar connected className="mb-8" />
        <SettingsClient initialSettings={settings} tokenExpiresInMin={tokenExpiresInMin} />
      </div>
      <style>{`@keyframes lafz-shimmer { to { background-position: -250% 0; } }`}</style>
    </main>
  );
}
