/**
 * Regenerate the WhatsApp Flow JSON files from the form definitions:
 *   pnpm tsx whatsapp/flows/generate.ts
 * A unit test (src/lib/forms/flow-json.test.ts) fails when the committed files drift from the definitions.
 */
import fs from "node:fs";
import path from "node:path";
import { configContext } from "@/lib/forms/flow-context";
import { enquiryFlowJson, maintenanceVisitFlowJson } from "@/lib/forms/flow-json";
import { THORBURN_CONFIG } from "@/lib/tenant";

const dir = path.join(process.cwd(), "whatsapp", "flows");
const ctx = configContext(THORBURN_CONFIG);
const files: Record<string, unknown> = {
  "enquiry.json": enquiryFlowJson(ctx),
  "maintenance-visit.json": maintenanceVisitFlowJson(ctx),
};
for (const [name, json] of Object.entries(files)) {
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(json, null, 2)}\n`);
  console.log(`wrote whatsapp/flows/${name}`);
}
