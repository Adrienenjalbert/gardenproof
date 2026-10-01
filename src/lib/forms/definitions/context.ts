import type { FormGlyph, FormOption } from "../types";

/** What a definition needs to know about the business (built by brand.ts from tenants.config/profile). */
export type DefinitionContext = {
  businessName: string;
  ownerFirstName: string | null;
  services: { key: string; label: string; image?: string | null; glyph?: FormGlyph }[];
  /** Photo cards from the business's own portfolio (value = project slug/title key). */
  styles: FormOption[];
};
