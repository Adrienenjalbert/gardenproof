"use client";
/**
 * Keeps a page fresh while background work is in flight: re-fetches the server components every few seconds
 * (router.refresh keeps client state) and stops as soon as nothing is queued or running.
 */
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function TaskPoller({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}
