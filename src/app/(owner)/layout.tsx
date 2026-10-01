import type { Metadata, Viewport } from "next";
import type { CSSProperties } from "react";
import { getOwnerContext } from "@/lib/owner/tenant";
import "./owner.css";

// The owner's data changes all day (crew photos, replies, scheduled messages): always render fresh.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "GardenProof", template: "%s · GardenProof" },
  robots: { index: false },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2ef" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

async function brandStyle(): Promise<CSSProperties> {
  try {
    const { brand } = await getOwnerContext();
    return {
      "--brand": brand.accent,
      ...(brand.displayFont ? { "--brand-font": `"${brand.displayFont}"` } : {}),
    } as CSSProperties;
  } catch {
    return {}; // no tenant yet (fresh install): calm defaults
  }
}

export default async function OwnerRoot({ children }: LayoutProps<"/">) {
  return (
    <div className="owner min-h-dvh w-full" style={await brandStyle()}>
      {children}
    </div>
  );
}
