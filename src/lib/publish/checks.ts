/** Which failing automated checks keep an asset (or a sibling in an export bundle) from going public. */
export type AssetCheck = { id: string; ok: boolean; message: string };

/**
 * Consent first: any failing `consent*` check (photos, quote, name, area…) or `privacy` check (address,
 * surname, postcode) blocks publishing, even when the operator approved the asset.
 */
export const isBlockingCheckId = (id: string) => id.startsWith("consent") || id === "privacy";

export function blockingChecks(checks: AssetCheck[]): string[] {
  return checks.filter((c) => !c.ok && isBlockingCheckId(c.id)).map((c) => `${c.id}: ${c.message}`);
}
