/**
 * Consent wording — the single source of truth for what the homeowner sees AND what we store as
 * evidence (UK GDPR). Client-safe (no server imports): the /r/[token] page renders from this too.
 */
export type ConsentKey = "consentPhotos" | "consentArea" | "consentFirstName" | "consentQuote";

export type ConsentItem = { key: ConsentKey; title: string; statement: string };

export const CONSENT_KEYS: ConsentKey[] = ["consentPhotos", "consentArea", "consentFirstName", "consentQuote"];

export function consentItems(businessName: string, area: string | null): ConsentItem[] {
  const areaExample = area ? `"${area}"` : "the neighbourhood";
  return [
    {
      key: "consentPhotos",
      title: "Photos of your garden",
      statement: `${businessName} may show photos of my garden on their website, social media and adverts.`,
    },
    {
      key: "consentArea",
      title: "Your area",
      statement: `${businessName} may name my area (${areaExample}) alongside the photos. Never my street or house number.`,
    },
    {
      key: "consentFirstName",
      title: "Your first name",
      statement: `${businessName} may show my first name next to my words.`,
    },
    {
      key: "consentQuote",
      title: "Your words",
      statement: `${businessName} may quote my words above on their website, social media and adverts, as I wrote them or shortened without changing their meaning.`,
    },
  ];
}

/** The quote question only makes sense when there is a quote that could ever be published (4 or 5 stars). */
export function quoteConsentApplies(rating: number, quote: string | null | undefined): boolean {
  return rating >= 4 && Boolean(quote?.trim());
}

export const ADDRESS_REASSURANCE =
  "We never share your address, street or house number. You can change your mind at any time: just open this link again.";

/** The exact text stored with the answers, e.g. "[YES] Photos of your garden: … ". */
export function consentWording(
  businessName: string,
  area: string | null,
  answers: Record<ConsentKey, boolean>,
  opts: { quoteAsked?: boolean } = {},
): string {
  const lines = consentItems(businessName, area).map((item) => {
    const notAsked = item.key === "consentQuote" && opts.quoteAsked === false;
    return `[${answers[item.key] ? "YES" : "NO"}] ${item.title}: ${item.statement}${notAsked ? " (not asked: no public comment given)" : ""}`;
  });
  return [...lines, ADDRESS_REASSURANCE].join("\n");
}
