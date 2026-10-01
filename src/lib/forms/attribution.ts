/** Attribution for the public enquiry link: the click that brought someone in, in the leads "Touch" shape. */
import { TouchSchema, type Touch } from "@/app/api/leads/lead";

/** A JSON touch passed through by gp-track.js (gp_ft / gp_lt), or undefined when absent/invalid. */
export function touchParam(raw: string | null): Touch | undefined {
  if (!raw) return undefined;
  try {
    const parsed = TouchSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** The click that brought them here (utm_* / click ids / referrer). */
export function touchFromRequest(url: URL, referrer: string | null): Touch {
  const q = url.searchParams;
  const pick = (k: string) => q.get(k)?.slice(0, 200) || undefined;
  const parsed = TouchSchema.safeParse({
    source: pick("utm_source"),
    medium: pick("utm_medium"),
    campaign: pick("utm_campaign"),
    content: pick("utm_content"),
    term: pick("utm_term"),
    gclid: pick("gclid"),
    fbclid: q.get("fbclid")?.slice(0, 500) || undefined,
    landingPage: url.toString().slice(0, 2000),
    referrer: referrer?.slice(0, 2000) || undefined,
    ts: Date.now(),
  });
  return parsed.success ? parsed.data : {};
}

