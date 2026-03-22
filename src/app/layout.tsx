import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Manrope, Plus_Jakarta_Sans, Space_Grotesk } from "next/font/google";

import "@/app/globals.css";

const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display"
});

const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-body"
});

const jakartaFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta"
});

export const metadata: Metadata = {
  title: "Lafz",
  description: "Live translated lyrics for the music you are playing now, with Spotify available today and Apple Music sync planned next."
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${displayFont.variable} ${bodyFont.variable} ${jakartaFont.variable}`}>
      <body>{children}</body>
    </html>
  );
}
