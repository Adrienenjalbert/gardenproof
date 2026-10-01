/**
 * Owner preferences the CRM engine reads (stored in tenants.settings). `tenants.settings` is typed in the schema
 * with notifications + directory only; the message style and the routine auto-send switch live next to them
 * (see docs/contract-requests.md). This file is the single place that reads/writes those extra keys.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import type { Tenant } from "@/db/schema";
import { DEFAULT_NOTIFICATIONS, type NotificationSettings } from "@/lib/crm";
import { readOutputs, type ContentOutputs } from "@/lib/outputs";

export const TONES = ["warm", "professional", "brief"] as const;
export type Tone = (typeof TONES)[number];

export type MessageStyle = { tone: Tone; signOff: string | null };

export const INSTANT_KINDS = ["new_enquiry", "low_review", "customer_needs_owner", "quote_accepted"] as const;
export type InstantKind = (typeof INSTANT_KINDS)[number];

export type OwnerSettings = {
  notifications: NotificationSettings;
  style: MessageStyle;
  /**
   * Routine customer messages (acknowledgements, reminders) go out without waiting for approval.
   * Off by default: safe mode then holds them until someone says yes.
   */
  autoSendRoutine: boolean;
  /** What is made for each finished job (see @/lib/outputs). */
  outputs: ContentOutputs;
};

type StoredSettings = Tenant["settings"] & {
  messageStyle?: Partial<MessageStyle>;
  autoSendRoutine?: boolean;
  outputs?: Partial<ContentOutputs>;
};

export const OutputsInput = z.object({
  ads: z.boolean(),
  social: z.boolean(),
  areaArticles: z.boolean(),
  allVideoFormats: z.boolean(),
});

export const DEFAULT_STYLE: MessageStyle = { tone: "warm", signOff: null };

export const NotificationsInput = z.object({
  instant: z.array(z.enum(INSTANT_KINDS)).max(INSTANT_KINDS.length),
  digestHour: z.number().int().min(0).max(23).nullable(),
  autoApproveAfterDays: z.number().int().min(1).max(365).nullable(),
});

export const StyleInput = z.object({
  tone: z.enum(TONES),
  signOff: z.string().trim().max(80).nullable(),
});

export function readSettings(tenant: Pick<Tenant, "settings">): OwnerSettings {
  const s = (tenant.settings ?? {}) as StoredSettings;
  const n = s.notifications;
  return {
    notifications: {
      instant: n?.instant ?? DEFAULT_NOTIFICATIONS.instant,
      digestHour: n && "digestHour" in n ? n.digestHour : DEFAULT_NOTIFICATIONS.digestHour,
      autoApproveAfterDays:
        n && "autoApproveAfterDays" in n ? n.autoApproveAfterDays : DEFAULT_NOTIFICATIONS.autoApproveAfterDays,
    },
    style: { ...DEFAULT_STYLE, ...(s.messageStyle ?? {}) },
    autoSendRoutine: s.autoSendRoutine ?? false,
    outputs: readOutputs(s),
  };
}

export async function loadSettings(tenantId: string): Promise<OwnerSettings> {
  const db = await getDb();
  const [t] = await db
    .select({ settings: schema.tenants.settings })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId));
  return readSettings(t ?? { settings: {} });
}

/** Merge a partial change into tenants.settings (keeps keys other modules own, e.g. `directory`). */
export async function saveSettings(
  tenantId: string,
  patch: {
    notifications?: NotificationSettings;
    style?: MessageStyle;
    autoSendRoutine?: boolean;
    outputs?: ContentOutputs;
  },
): Promise<OwnerSettings> {
  const db = await getDb();
  const [t] = await db
    .select({ settings: schema.tenants.settings })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId));
  const current = (t?.settings ?? {}) as StoredSettings;
  const next: StoredSettings = {
    ...current,
    ...(patch.notifications ? { notifications: NotificationsInput.parse(patch.notifications) } : {}),
    ...(patch.style ? { messageStyle: StyleInput.parse(patch.style) } : {}),
    ...(patch.autoSendRoutine !== undefined ? { autoSendRoutine: patch.autoSendRoutine } : {}),
    ...(patch.outputs ? { outputs: OutputsInput.parse(patch.outputs) } : {}),
  };
  await db.update(schema.tenants).set({ settings: next }).where(eq(schema.tenants.id, tenantId));
  return readSettings({ settings: next });
}
