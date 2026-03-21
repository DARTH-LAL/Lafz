import { StatePanel } from "@/components/state-panel";

export default function Loading() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-10 lg:px-10">
      <StatePanel
        eyebrow="Loading"
        title="Booting Lafz"
        description="Preparing the web prototype and checking whether Spotify is already connected."
      />
    </main>
  );
}
