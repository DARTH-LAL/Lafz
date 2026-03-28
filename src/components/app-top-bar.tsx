"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type AppTopBarProps = {
  connected?: boolean;
  className?: string;
};

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M12 3.1 3 10.3V21h6v-5h6v5h6V10.3l-9-7.2Zm7 16h-2v-5H7v5H5v-7.9l7-5.6 7 5.6v7.9Z" />
    </svg>
  );
}

function QueueIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" />
    </svg>
  );
}

function ImportIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M19 11h-6V5h-2v6H5v2h6v6h2v-6h6z" />
    </svg>
  );
}

function AnalyticsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M5 20h2v-8H5v8zm4 0h2V4H9v16zm4 0h2v-4h-2v4zm4 0h2v-12h-2v12z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
      <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.92c.04-.32.07-.64.07-.98s-.03-.67-.07-1l2.11-1.63c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.33-.07.65-.07 1s.03.65.07.97l-2.11 1.66c-.19.15-.25.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1.01c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1.01c.22.08.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.66Z" />
    </svg>
  );
}

function buildNavItemClass(isActive: boolean) {
  return [
    "inline-flex h-10 w-10 items-center justify-center rounded-full border transition",
    isActive
      ? "border-[rgba(255,20,100,0.80)] bg-[rgba(255,20,100,0.18)] text-white shadow-[0_0_0_1px_rgba(255,20,100,0.20),0_0_16px_rgba(255,20,100,0.70),0_0_36px_rgba(255,20,100,0.35)]"
      : "border-white/10 bg-white/[0.03] text-white/40 hover:border-[rgba(255,20,100,0.30)] hover:bg-[rgba(255,20,100,0.07)] hover:text-[#ff9abf]"
  ].join(" ");
}

export function AppTopBar({ connected = false, className }: AppTopBarProps) {
  const pathname = usePathname();

  return (
    <nav
      className={[
        "flex items-center justify-between px-5 py-3 backdrop-blur-2xl",
        "rounded-[20px] border border-[rgba(255,20,100,0.60)] bg-[rgba(6,2,5,0.92)]",
        "shadow-[0_0_0_1px_rgba(255,20,100,0.18),0_0_18px_rgba(255,20,100,0.45),0_0_48px_rgba(255,20,100,0.22),0_0_100px_rgba(255,20,100,0.10),0_6px_32px_rgba(0,0,0,0.70),inset_0_1px_0_rgba(255,20,100,0.18)]",
        className ?? ""
      ].join(" ")}
    >
      <Link href={connected ? "/" : "/login"} className="text-[24px] font-extrabold tracking-[-1px] text-[#fff0f6] [text-shadow:0_0_18px_rgba(255,255,255,0.12)]">
        la
        <span className="bg-[linear-gradient(135deg,#ff1464_0%,#ff6ba8_100%)] bg-clip-text text-transparent [filter:drop-shadow(0_0_8px_rgba(255,20,100,0.7))]">F</span>
        z
      </Link>

      <div className="flex items-center gap-2">
        {connected ? (
          <div
            className="hidden items-center gap-2 rounded-full px-4 py-1.5 text-[11px] font-bold tracking-[0.5px] text-[#ff6ba8] sm:inline-flex"
            style={{
              border: "1px solid rgba(255,20,100,0.55)",
              background: "rgba(255,20,100,0.10)",
              boxShadow: "0 0 0 1px rgba(255,20,100,0.12), 0 0 12px rgba(255,20,100,0.40), 0 0 28px rgba(255,20,100,0.18)",
              textShadow: "0 0 12px rgba(255,20,100,0.70)"
            }}
          >
            <span
              className="h-2 w-2 rounded-full bg-[#ff1464]"
              style={{
                boxShadow: "0 0 6px 2px rgba(255,20,100,0.90), 0 0 14px rgba(255,20,100,0.60)",
                animation: "lafz-pulse 2s ease-in-out infinite"
              }}
            />
            Spotify connected
          </div>
        ) : null}

        <Link href="/" className={buildNavItemClass(pathname === "/")} aria-label="Now playing">
          <HomeIcon />
        </Link>
        <Link
          href="/library/queue"
          className={buildNavItemClass(pathname === "/library/queue" || pathname.startsWith("/library/track/"))}
          aria-label="Translation queue"
        >
          <QueueIcon />
        </Link>
        <Link
          href="/library/import"
          className={buildNavItemClass(pathname === "/library/import")}
          aria-label="Import music"
        >
          <ImportIcon />
        </Link>
        <Link
          href="/analytics"
          className={buildNavItemClass(pathname === "/analytics")}
          aria-label="AI analytics"
        >
          <AnalyticsIcon />
        </Link>
        <Link
          href="/settings"
          className={buildNavItemClass(pathname === "/settings")}
          aria-label="Settings"
        >
          <SettingsIcon />
        </Link>
      </div>
    </nav>
  );
}
