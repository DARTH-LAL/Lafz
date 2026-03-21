import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";

import "@/app/globals.css";

const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display"
});

const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-body"
});

export const metadata: Metadata = {
  title: "Lafz",
  description: "A personal Spotify-to-translation prototype for real-time synced lyric meaning."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
