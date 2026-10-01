/** Review providers as people say them (client-safe). */
export function providerName(p: string): string {
  return (
    (
      {
        google: "Google",
        which: "Which?",
        checkatrade: "Checkatrade",
        trustmark: "TrustMark",
        trustpilot: "Trustpilot",
        houzz: "Houzz",
        facebook: "Facebook",
        yell: "Yell",
        website: "Your website",
      } as Record<string, string>
    )[p] ?? "Online"
  );
}
