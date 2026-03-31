import { redirect } from "next/navigation";
import { readSpotifySessionFromCookies } from "@/features/spotify/session";
import { BrainFullscreen } from "@/components/brain-fullscreen";

export const metadata = { title: "Lafz Brain — Fullscreen" };

export default async function BrainFullscreenPage() {
  const session = await readSpotifySessionFromCookies();
  if (!session) redirect("/login");

  return <BrainFullscreen />;
}
