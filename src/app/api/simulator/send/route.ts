/**
 * POST /api/simulator/send (multipart): a message "from" a persona's phone into the real bot.
 * Fields: phone, text?, choiceId?, file* (uploads), demo* (names of stills in public/demo).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { handleInbound } from "@/lib/bot";
import { normalisePhone } from "@/lib/messaging";
import { listPersonas, notFound, simulatorEnabled } from "../_shared";

const MAX_BYTES = 20 * 1024 * 1024;
const DEMO_DIR = path.join(process.cwd(), "public", "demo");
const DEMO_MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

const Fields = z.object({
  phone: z.string().min(5),
  text: z.string().max(4096).default(""),
  choiceId: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  if (!simulatorEnabled()) return notFound();
  const form = await req.formData();
  const parsed = Fields.safeParse({
    phone: form.get("phone"),
    text: form.get("text") ?? "",
    choiceId: form.get("choiceId") || undefined,
  });
  if (!parsed.success) return Response.json({ error: "Invalid input" }, { status: 400 });

  const media: { buffer: Buffer; mimeType: string }[] = [];
  for (const entry of form.getAll("file")) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    if (entry.size > MAX_BYTES) return Response.json({ error: "File too large (20MB max)" }, { status: 413 });
    // Browsers often give .vcf files no type; treat them as the contact cards they are.
    const mimeType = entry.type || (/\.vcf$/i.test(entry.name) ? "text/vcard" : "application/octet-stream");
    media.push({ buffer: Buffer.from(await entry.arrayBuffer()), mimeType });
  }
  for (const name of form.getAll("demo")) {
    const file = path.basename(String(name)); // no path traversal: stills live flat in public/demo
    const mimeType = DEMO_MIME[path.extname(file).toLowerCase()];
    if (!mimeType) continue;
    try {
      media.push({ buffer: await fs.readFile(path.join(DEMO_DIR, file)), mimeType });
    } catch {
      return Response.json({ error: `Unknown demo still ${file}` }, { status: 400 });
    }
  }
  if (!parsed.data.text.trim() && !parsed.data.choiceId && media.length === 0) {
    return Response.json({ error: "Nothing to send" }, { status: 400 });
  }

  const { tenantId } = await listPersonas();
  // Pipeline work (AI, video) is queued by the bot, never run here, so the chat answers at once.
  const result = await handleInbound({
    tenantId,
    from: normalisePhone(parsed.data.phone),
    body: parsed.data.text,
    choiceId: parsed.data.choiceId ?? null,
    media,
    channel: "simulator",
  });
  return Response.json({ ok: true, role: result.role });
}
