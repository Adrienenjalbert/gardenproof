import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { env } from "@/lib/config";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (!env.adminPassword) redirect("/");
  const { next } = await searchParams;
  return (
    <main className="grid min-h-dvh place-items-center bg-olive-dark px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-leaf font-display text-lg font-bold text-olive-dark">
            G
          </span>
          <h1 className="font-display text-2xl text-white">GardenProof</h1>
          <p className="mt-1 text-sm text-white/60">Agency review dashboard</p>
        </div>
        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <LoginForm next={typeof next === "string" ? next : "/"} />
        </div>
        <p className="mt-6 text-center text-xs text-white/40">Homeowner links and the portfolio stay public.</p>
      </div>
    </main>
  );
}
