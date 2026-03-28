import { redirect } from "next/navigation";
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
    <main className="relative min-h-screen w-full overflow-x-hidden bg-[#060410] text-[#fff0f6]">
      {/* Background glows */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -right-40 -top-40 h-[700px] w-[700px] rounded-full bg-[radial-gradient(circle,rgba(255,20,100,0.18)_0%,transparent_60%)]" />
        <div className="absolute -left-28 bottom-0 h-[500px] w-[600px] rounded-full bg-[radial-gradient(ellipse,rgba(255,0,100,0.10)_0%,transparent_65%)]" />
      </div>
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: "radial-gradient(rgba(255,20,100,0.10) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 80% at 50% 50%, black 30%, transparent 100%)"
        }}
      />
      <div className="relative z-10 mx-auto max-w-[860px] px-6 py-8 lg:px-10">
        <AppTopBar connected className="mb-8" />
        <SettingsClient initialSettings={settings} tokenExpiresInMin={tokenExpiresInMin} />
      </div>
      <style>{`@keyframes lafz-shimmer { to { background-position: -250% 0; } }`}</style>
    </main>
  );
}
