import { redirect } from "next/navigation";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";
import AnalyticsDashboard from "@/components/analytics-dashboard";
import { getUsageAnalytics } from "@/features/ai/usage-tracker";
import { AppTopBar } from "@/components/app-top-bar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AnalyticsPage() {
  const session = await readSpotifySessionFromCookies();
  if (!session) redirect("/login");

  const initialData = getUsageAnalytics("30d");

  return (
    <>
      <AppTopBar />
      <AnalyticsDashboard initialData={initialData} initialPeriod="30d" />
    </>
  );
}
