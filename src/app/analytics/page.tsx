import { redirect } from "next/navigation";
import { AnimatedBackground } from "@/components/animated-background";
import { AppTopBar } from "@/components/app-top-bar";
import AnalyticsDashboard from "@/components/analytics-dashboard";
import { getUsageAnalytics } from "@/features/ai/usage-tracker";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AnalyticsPage() {
  const session = await readSpotifySessionFromCookies();
  if (!session) redirect("/login");

  const initialData = await getUsageAnalytics("30d");

  return (
    <main className="relative min-h-screen w-full overflow-x-hidden text-[#fff0f6]">
      <AnimatedBackground />
      <div className="relative z-10 mx-auto max-w-6xl px-6 py-8 lg:px-10">
        <AppTopBar connected className="mb-8" />
        <AnalyticsDashboard initialData={initialData} initialPeriod="30d" />
      </div>
    </main>
  );
}
