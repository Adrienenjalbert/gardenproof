/**
 * UK postcode -> neighbourhood, via postcodes.io (free, no key). The business's own area names win
 * ("SW19" -> "Wimbledon"); otherwise the local authority ("Merton"). If postcodes.io can't be reached the
 * postcode is still accepted on format alone (verified: false): never block an enquiry on a lookup.
 */
import { z } from "zod";
import { areaFromPostcode, type TenantConfig } from "@/lib/tenant";
import type { BusinessProfile } from "@/lib/intel/types";
import { normalisePostcode } from "./engine";
import type { PostcodeValue } from "./types";

const LOOKUP_TIMEOUT_MS = 2500;

const PostcodesIoSchema = z.object({
  status: z.number(),
  result: z
    .object({
      postcode: z.string(),
      outcode: z.string(),
      admin_district: z.string().nullable(),
      admin_ward: z.string().nullable().optional(),
    })
    .nullable(),
});

export type PostcodeLookup = { postcode: string; district: string | null; verified: boolean; exists: boolean };

/** Ask postcodes.io. `exists: false` only when it answered 404 (a real "no such postcode"). */
export async function lookupPostcode(raw: string, fetchImpl: typeof fetch = fetch): Promise<PostcodeLookup | null> {
  const postcode = normalisePostcode(raw);
  if (!postcode) return null;
  try {
    const res = await fetchImpl(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.replace(" ", ""))}`, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (res.status === 404) return { postcode, district: null, verified: false, exists: false };
    if (!res.ok) return { postcode, district: null, verified: false, exists: true };
    const parsed = PostcodesIoSchema.safeParse(await res.json());
    const r = parsed.success ? parsed.data.result : null;
    return r ? { postcode: r.postcode, district: r.admin_district, verified: true, exists: true } : { postcode, district: null, verified: false, exists: true };
  } catch {
    return { postcode, district: null, verified: false, exists: true };
  }
}

const outwardOf = (postcode: string) => postcode.split(" ")[0];

/** Area name + whether it's one the business covers. */
export function areaFor(postcode: string, config: TenantConfig, profile: BusinessProfile | null): { area: string | null; inArea: boolean } {
  const outward = outwardOf(postcode);
  const fromConfig = areaFromPostcode(postcode, config);
  const fromProfile = profile?.areas.find((a) => a.outward?.toUpperCase() === outward)?.name ?? null;
  const area = fromConfig ?? fromProfile;
  return { area, inArea: !!area };
}

/** Full stored value for a postcode answer. Returns null for an invalid or non-existent postcode. */
export async function resolvePostcode(
  raw: string,
  config: TenantConfig,
  profile: BusinessProfile | null,
  fetchImpl: typeof fetch = fetch,
): Promise<PostcodeValue | null> {
  const found = await lookupPostcode(raw, fetchImpl);
  if (!found || !found.exists) return null;
  const { area, inArea } = areaFor(found.postcode, config, profile);
  return { postcode: found.postcode, area: area ?? found.district, district: found.district, verified: found.verified, inArea };
}
