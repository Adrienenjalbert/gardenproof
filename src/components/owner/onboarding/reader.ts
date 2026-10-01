/**
 * Talks to the website reader (the intel module's /api/onboarding). When that API isn't there (404/405/501) or the
 * network is down, it switches to the offline sample so the set-up flow still works end to end; the UI says so.
 */
import type { BusinessProfile } from "@/lib/intel/types";

export type ReadStep = {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  detail?: string;
};
export type ReadState = {
  status: "running" | "ready" | "failed";
  steps: ReadStep[];
  runId: string | null;
  error?: string;
};

export const OFFLINE_STEPS: Omit<ReadStep, "status">[] = [
  { key: "open", label: "Opening your website" },
  { key: "brand", label: "Finding your logo and colours" },
  { key: "services", label: "Reading your services and areas" },
  { key: "projects", label: "Collecting your project photos" },
  { key: "reviews", label: "Looking for your reviews" },
  { key: "badges", label: "Checking your badges with each body" },
];

const FRIENDLY: Record<string, string> = {
  queued: "running",
  running: "running",
  ready: "ready",
  confirmed: "ready",
  failed: "failed",
};

type RunJson = {
  id?: string;
  runId?: string;
  status?: string;
  steps?: ReadStep[];
  error?: string | null;
  run?: RunJson;
};

function normalise(j: RunJson): { status: ReadState["status"]; steps: ReadStep[]; error?: string } {
  const r = j.run ?? j;
  return {
    status: (FRIENDLY[r.status ?? "running"] ?? "running") as ReadState["status"],
    steps: r.steps ?? [],
    error: r.error ?? undefined,
  };
}

/** Start reading. Returns the live run id, or null when the live reader isn't available. Throws on a bad URL. */
export async function startLive(url: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch {
    return null;
  }
  if ([404, 405, 501, 503].includes(res.status)) return null;
  const j = (await res.json().catch(() => ({}))) as RunJson & { error?: string; message?: string };
  if (!res.ok) throw new Error(j.error ?? j.message ?? "That doesn't look like a website address.");
  return j.runId ?? j.id ?? j.run?.id ?? null;
}

export async function pollLive(runId: string): Promise<ReturnType<typeof normalise>> {
  const res = await fetch(`/api/onboarding/${encodeURIComponent(runId)}`, { cache: "no-store" });
  if (!res.ok) throw new Error("We lost track of the reading. Please try again.");
  return normalise((await res.json()) as RunJson);
}

export type Loaded = { profile: BusinessProfile; runId: string | null; sample: boolean };
