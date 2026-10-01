/**
 * In-app WhatsApp simulator: talk to the real capture bot as Marco, Jake, Stephen, a customer
 * or a stranger. Same code path as the Twilio webhook (handleInbound), so what you see is what crews get.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listPersonas, simulatorEnabled } from "@/app/api/simulator/_shared";
import { env } from "@/lib/config";
import { Simulator } from "./simulator";

export const metadata: Metadata = { title: "WhatsApp simulator", robots: { index: false } };

async function demoStills(): Promise<string[]> {
  try {
    const files = await fs.readdir(path.join(process.cwd(), "public", "demo"));
    // Befores first: that's the order a crew sends them in.
    return files
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .sort((a, b) => Number(b.includes("before")) - Number(a.includes("before")) || a.localeCompare(b));
  } catch {
    return [];
  }
}

export default async function SimulatorPage({ searchParams }: PageProps<"/simulator">) {
  if (!simulatorEnabled()) notFound();
  const [{ tenantName, personas }, stills, sp] = await Promise.all([listPersonas(), demoStills(), searchParams]);
  const requested = typeof sp.phone === "string" ? sp.phone : null;
  const initialPhone = personas.find((p) => p.phone === requested)?.phone ?? personas[0]?.phone ?? "";
  return (
    <Simulator
      tenantName={tenantName}
      personas={personas}
      stills={stills}
      initialPhone={initialPhone}
      safeMode={env.safeMode}
    />
  );
}
