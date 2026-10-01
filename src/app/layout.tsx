import type { Metadata } from "next";
import localFont from "next/font/local";
import { env } from "@/lib/config";
import "./globals.css";

// Self-hosted (SIL OFL) — the same files the video renderer uses, so ads and pages share one typography.
const display = localFont({
  variable: "--font-display",
  src: [
    { path: "../../video/fonts/Arvo-Regular.woff2", weight: "400", style: "normal" },
    { path: "../../video/fonts/Arvo-Italic.woff2", weight: "400", style: "italic" },
    { path: "../../video/fonts/Arvo-Bold.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
});
const sans = localFont({
  variable: "--font-sans-base",
  src: [{ path: "../../video/fonts/NunitoSans-Variable.woff2", weight: "200 1000", style: "normal" }],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(env.appUrl),
  title: { default: "GardenProof", template: "%s · GardenProof" },
  description: "Turn every finished garden job into portfolio pages, reviews and ads.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className={`${display.variable} ${sans.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
