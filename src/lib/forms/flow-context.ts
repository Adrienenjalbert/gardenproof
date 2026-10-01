/** Definition context from a tenant config alone (no DB): used for the committed WhatsApp Flow JSON files. */
import type { TenantConfig } from "@/lib/tenant";
import type { DefinitionContext } from "./definitions";

export function configContext(config: TenantConfig): DefinitionContext {
  return {
    businessName: config.name,
    ownerFirstName: null,
    services: config.services.map((s) => ({ key: s.key, label: s.label })),
    styles: [],
  };
}
