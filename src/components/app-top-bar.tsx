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

function buildNavItemClass(isActive: boolean) {
  return [
    "inline-flex h-10 w-10 items-center justify-center rounded-full border transition",
    isActive
      ? "border-[#ff2d78]/35 bg-[rgba(255,45,120,0.12)] text-[#fff0f6]"
      : "border-white/12 bg-white/[0.02] text-[#8f7ca7] hover:border-white/18 hover:bg-white/5 hover:text-white"
  ].join(" ");
}

export function AppTopBar({ connected = false, className }: AppTopBarProps) {
  const pathname = usePathname();

  return (
    <nav
      className={[
        "flex items-center justify-between border border-white/8 bg-[rgba(7,5,16,0.78)] px-5 py-3 backdrop-blur-2xl",
        "rounded-[24px] shadow-[0_18px_60px_rgba(0,0,0,0.28)]",
        className ?? ""
      ].join(" ")}
    >
      <Link href={connected ? "/" : "/login"} className="text-[24px] font-extrabold tracking-[-1px] text-[#fff0f6]">
        la
        <span className="bg-[linear-gradient(135deg,#ff2d78_0%,#ff6ba8_100%)] bg-clip-text text-transparent">F</span>
        z
      </Link>

      <div className="flex items-center gap-2">
        {connected ? (
          <div className="hidden items-center gap-2 rounded-full border border-[rgba(255,45,120,0.22)] bg-[rgba(255,45,120,0.09)] px-3 py-1.5 text-[11px] font-semibold text-[#ff6ba8] sm:inline-flex">
            <span className="lafz-badge-ring h-1.5 w-1.5 rounded-full bg-[#ff2d78]" />
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
      </div>
    </nav>
  );
}
