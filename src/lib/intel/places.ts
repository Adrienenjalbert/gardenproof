/**
 * Place lookups via postcodes.io (free, no key): outward code for an area name and the district/region of a
 * postcode. Optional enrichment only: any failure returns null and onboarding carries on.
 */
export type LatLon = { lat: number; lon: number };
export type PlaceLookup = {
  /** Outward code of a named place, choosing the one nearest `near` (many UK place names repeat: Richmond). */
  outwardFor(place: string, near?: LatLon | null): Promise<string | null>;
  postcodeInfo(postcode: string): Promise<{ district: string | null; region: string | null; lat: number | null; lon: number | null } | null>;
};

/** Great-circle distance in km. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
const MAX_KM = 40;

type Fetch = typeof fetch;

export function postcodesIo(fetchImpl: Fetch = fetch): PlaceLookup {
  const cache = new Map<string, Promise<unknown>>();
  const get = <T>(url: string): Promise<T | null> => {
    if (!cache.has(url)) {
      cache.set(
        url,
        fetchImpl(url, { signal: AbortSignal.timeout(5000) })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      );
    }
    return cache.get(url) as Promise<T | null>;
  };
  return {
    async outwardFor(place, near) {
      const res = await get<{ result?: { name_1?: string; outcode?: string; latitude?: number; longitude?: number }[] }>(
        `https://api.postcodes.io/places?q=${encodeURIComponent(place)}&limit=20`,
      );
      const hits = (res?.result ?? []).filter((r) => r.name_1?.toLowerCase() === place.toLowerCase() && r.outcode && r.latitude != null && r.longitude != null);
      if (near) {
        const ranked = hits
          .map((r) => ({ r, km: distanceKm(near, { lat: r.latitude!, lon: r.longitude! }) }))
          .filter((x) => x.km <= MAX_KM)
          .sort((a, b) => a.km - b.km);
        return ranked[0]?.r.outcode ?? null;
      }
      const codes = [...new Set(hits.map((h) => h.outcode))];
      return codes.length === 1 ? (codes[0] ?? null) : null;
    },
    async postcodeInfo(pc) {
      const res = await get<{ result?: { admin_district?: string; region?: string; latitude?: number; longitude?: number } }>(
        `https://api.postcodes.io/postcodes/${encodeURIComponent(pc.replace(/\s+/g, ""))}`,
      );
      const r = res?.result;
      return r ? { district: r.admin_district ?? null, region: r.region ?? null, lat: r.latitude ?? null, lon: r.longitude ?? null } : null;
    },
  };
}

/** For tests and offline runs. */
export const noPlaces: PlaceLookup = { outwardFor: async () => null, postcodeInfo: async () => null };
