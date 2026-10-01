/**
 * Runtime flags. Everything works with zero env vars (demo mode):
 * - no ANTHROPIC_API_KEY      -> deterministic mock AI (clearly labelled "[demo]")
 * - no TWILIO_* credentials   -> messages go to the in-app WhatsApp simulator
 * - no WORDPRESS_* creds      -> publishing writes a local HTML preview instead
 * - no SUPABASE_* storage     -> media on local disk (STORAGE_DIR, default .data/storage)
 * - SAFE_MODE (default "on")  -> outbound messages to customers are HELD for agency approval
 *
 * In production (NODE_ENV=production) `assertProductionConfig()` refuses to start with an unsafe setup.
 */
export const env = {
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  anthropicKey: process.env.ANTHROPIC_API_KEY ?? null,
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID ?? null,
    authToken: process.env.TWILIO_AUTH_TOKEN ?? null,
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM ?? null, // e.g. "whatsapp:+447..."
    /** Approved Content template (HX…) for the homeowner review request (business-initiated, outside 24h). */
    reviewRequestTemplateSid: process.env.TWILIO_TEMPLATE_REVIEW_REQUEST ?? null,
  },
  wordpress: {
    baseUrl: process.env.WORDPRESS_BASE_URL ?? null,
    user: process.env.WORDPRESS_USER ?? null,
    appPassword: process.env.WORDPRESS_APP_PASSWORD ?? null,
  },
  /** Shared secret for the dashboard (Phase 1 single-operator auth). */
  adminPassword: process.env.ADMIN_PASSWORD ?? null,
  /** Bearer secret for /api/cron/* (required in production). */
  cronSecret: process.env.CRON_SECRET ?? null,
  safeMode: (process.env.SAFE_MODE ?? "on") !== "off",
  defaultTenantSlug: process.env.DEFAULT_TENANT ?? "thorburn",
};

export const isDemoAI = () => !env.anthropicKey;
export const isSimulatorMessaging = () => !(env.twilio.accountSid && env.twilio.authToken && env.twilio.whatsappFrom);
export const isLocalPublishing = () => !(env.wordpress.baseUrl && env.wordpress.user && env.wordpress.appPassword);
export const isProduction = () => process.env.NODE_ENV === "production";

type EnvVars = Record<string, string | undefined>;

/**
 * Unsafe production setups, as human-readable problems (empty = fine). Pure so it can be unit-tested.
 * - ADMIN_PASSWORD missing leaves the whole dashboard open, unless this is an explicit public demo (DEMO_MODE=on).
 * - Any Twilio setting without TWILIO_AUTH_TOKEN means webhook signatures can't be checked.
 * - Supabase storage must be configured completely or not at all.
 */
export function productionConfigProblems(vars: EnvVars = process.env): string[] {
  if (vars.NODE_ENV !== "production") return [];
  const problems: string[] = [];
  if (!vars.ADMIN_PASSWORD && vars.DEMO_MODE !== "on") {
    problems.push("ADMIN_PASSWORD is required in production (set DEMO_MODE=on only for a public demo with no real data).");
  }
  const twilioSet = Boolean(vars.TWILIO_ACCOUNT_SID || vars.TWILIO_WHATSAPP_FROM);
  if (twilioSet && !vars.TWILIO_AUTH_TOKEN) {
    problems.push("TWILIO_AUTH_TOKEN is required when Twilio is configured: webhook signatures must be validated.");
  }
  const supabase = [vars.SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, vars.SUPABASE_BUCKET];
  if (supabase.some(Boolean) && !supabase.every(Boolean)) {
    problems.push("Supabase storage needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SUPABASE_BUCKET together.");
  }
  if (vars.APP_URL && !/^https:\/\//.test(vars.APP_URL) && vars.DEMO_MODE !== "on") {
    problems.push("APP_URL must be https:// in production (homeowner links and Twilio signatures depend on it).");
  }
  return problems;
}

/** Called at server/worker startup. Throws (so the process refuses to serve) when production config is unsafe. */
export function assertProductionConfig(vars: EnvVars = process.env): void {
  const problems = productionConfigProblems(vars);
  if (problems.length) throw new Error(`Unsafe production configuration:\n- ${problems.join("\n- ")}`);
  if (vars.NODE_ENV === "production" && !vars.CRON_SECRET) {
    console.warn("[config] CRON_SECRET is not set: /api/cron/* is disabled (the worker schedules expiry itself).");
  }
}
