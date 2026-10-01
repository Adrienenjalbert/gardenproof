/**
 * Late-bound access to optional functions owned by other modules (the content engine's re-check).
 * The dashboard must degrade to a clear message instead of crashing when an export does not exist.
 */

export class NotAvailableError extends Error {}

type AsyncFn<A extends unknown[]> = (...args: A) => Promise<unknown>;

async function resolve<A extends unknown[]>(
  load: () => Promise<object>,
  name: string,
  what: string,
): Promise<AsyncFn<A>> {
  const mod = (await load()) as Record<string, unknown>;
  const fn = mod[name];
  if (typeof fn !== "function") {
    throw new NotAvailableError(`${what} is not available yet (the ${name}() module hasn't shipped).`);
  }
  return fn as AsyncFn<A>;
}

/**
 * Re-run automated checks after a manual edit, if the content engine exposes `recheckAsset(assetId)`.
 * Returns false when unavailable so the caller can keep going (edits must never be blocked by this).
 */
export async function recheckAssetOptional(assetId: string): Promise<boolean> {
  try {
    const fn = await resolve<[string]>(() => import("@/lib/content"), "recheckAsset", "Re-checking");
    await fn(assetId);
    return true;
  } catch (err) {
    if (!(err instanceof NotAvailableError)) console.error("[dashboard] recheckAsset failed", err);
    return false;
  }
}
