import { describe, expect, it } from "vitest";
import { consentWording } from "@/lib/testimonials/consent";
import { consentBlock, isActionable } from "./consent-state";
import { parseConsentWording } from "./consent-wording";
import {
  assetIdFromUtmContent,
  attributedAssetLabel,
  breakdownSentence,
  contentBreakdown,
  leadAssetCandidates,
  leadContentKind,
  parseAttribution,
} from "./lead-attribution";
import { approvalBlockers, bulkSkipReason } from "./logic";
import { KEPT_WITHHELD_TAG, blurReason, mediaPrivacy, needsPrivacyDecision } from "./media-privacy";
import { hasActiveWork, summariseBackground, taskLabel, visibleTaskStates, type TaskLike } from "./task-view";

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

const task = (o: Partial<TaskLike> & Pick<TaskLike, "id" | "type">): TaskLike => ({
  payload: {},
  status: "queued",
  attempts: 0,
  maxAttempts: 3,
  lastError: null,
  createdAt: new Date(1000),
  finishedAt: null,
  ...o,
});

describe("task labels", () => {
  it("names the work in progress", () => {
    expect(taskLabel(task({ id: "t", type: "pipeline.ready_for_content", status: "running" }))).toBe("Generating content…");
    expect(taskLabel(task({ id: "t", type: "video.render_asset", status: "running" }), { ratio: "9:16" })).toBe("Rendering 9:16…");
    expect(taskLabel(task({ id: "t", type: "asset.publish", status: "queued" }))).toBe("Publishing queued…");
  });
  it("offers retry on failure and shows automatic retries", () => {
    expect(taskLabel(task({ id: "t", type: "video.render_asset", status: "failed" }), { ratio: "1:1" })).toBe("1:1 render failed — retry");
    expect(taskLabel(task({ id: "t", type: "asset.publish", status: "failed" }))).toBe("Publishing failed — retry");
    expect(taskLabel(task({ id: "t", type: "asset.publish", status: "queued", attempts: 1, lastError: "WP 502" }))).toBe(
      "Publishing — retrying (attempt 2 of 3)…",
    );
  });
});

describe("visibleTaskStates", () => {
  it("keeps only the latest task per piece of work and hides finished work", () => {
    const states = visibleTaskStates(
      [
        task({ id: "old_fail", type: "asset.publish", payload: { assetId: "a1" }, status: "failed", lastError: "down", createdAt: new Date(1) }),
        task({ id: "new_ok", type: "asset.publish", payload: { assetId: "a1" }, status: "done", createdAt: new Date(2) }),
        task({ id: "render", type: "video.render_asset", payload: { assetId: "v1" }, status: "running", createdAt: new Date(3) }),
        task({ id: "gen_fail", type: "pipeline.ready_for_content", payload: { jobId: "j1" }, status: "failed", lastError: "AI timeout", createdAt: new Date(4) }),
      ],
      { v1: "9:16" },
    );
    expect(states.map((s) => s.taskId)).toEqual(["gen_fail", "render"]);
    expect(states[0]).toMatchObject({ jobId: "j1", error: "AI timeout", label: "Content generation failed — retry" });
    expect(states[1]).toMatchObject({ assetId: "v1", label: "Rendering 9:16…" });
  });

  it("summarises running / queued / failed for the Background work panel", () => {
    const states = visibleTaskStates([
      task({ id: "a", type: "asset.publish", payload: { assetId: "a" }, status: "running" }),
      task({ id: "b", type: "asset.publish", payload: { assetId: "b" }, status: "queued" }),
      task({ id: "c", type: "asset.publish", payload: { assetId: "c" }, status: "failed" }),
    ]);
    const s = summariseBackground(states);
    expect([s.running, s.queued, s.failed.map((f) => f.taskId)]).toEqual([1, 1, ["c"]]);
    expect(hasActiveWork(states)).toBe(true);
    expect(hasActiveWork(s.failed)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Consent blocks (QA B12)
// ---------------------------------------------------------------------------

describe("consentBlock", () => {
  const base = { jobId: "j1", requestHeld: false };
  const cust = { firstName: "Harriet", optedOut: false };
  it("explains a crew-only job and points to Add homeowner", () => {
    const b = consentBlock({ ...base, customer: null, testimonial: null });
    expect(b.kind).toBe("no_customer");
    expect(b.action?.href).toContain("#add-homeowner");
    expect(isActionable(b)).toBe(true);
  });
  it("sends the operator to Messages when the request is held", () => {
    const b = consentBlock({ ...base, requestHeld: true, customer: cust, testimonial: { status: "pending", consentPhotos: null, withdrawnAt: null } });
    expect(b).toMatchObject({ kind: "request_held", action: { href: "/ops/messages" } });
  });
  it("is not actionable while waiting for the homeowner", () => {
    const b = consentBlock({ ...base, customer: cust, testimonial: { status: "sent", consentPhotos: null, withdrawnAt: null } });
    expect(b.kind).toBe("awaiting_reply");
    expect(isActionable(b)).toBe(false);
  });
  it("covers declined, withdrawn, partial consent, expiry and opt-out", () => {
    const t = (o: object) => ({ status: "responded" as const, consentPhotos: true, withdrawnAt: null, ...o });
    expect(consentBlock({ ...base, customer: cust, testimonial: t({ consentPhotos: false }) }).kind).toBe("declined");
    expect(consentBlock({ ...base, customer: cust, testimonial: t({ withdrawnAt: new Date() }) }).kind).toBe("withdrawn");
    const partial = consentBlock({ ...base, customer: cust, testimonial: t({}), failedChecks: ["No first-name consent"] });
    expect(partial).toMatchObject({ kind: "needs_edit" });
    expect(partial.detail).toContain("No first-name consent");
    expect(consentBlock({ ...base, customer: cust, testimonial: t({ status: "expired", consentPhotos: null }) }).kind).toBe("expired");
    expect(consentBlock({ ...base, customer: { ...cust, optedOut: true }, testimonial: null }).kind).toBe("opted_out");
  });
});

// ---------------------------------------------------------------------------
// Approval guards
// ---------------------------------------------------------------------------

describe("approval guards", () => {
  it("blocks approval on consent and privacy failures only", () => {
    const checks = [
      { id: "consent-photos", ok: false, message: "no photo consent" },
      { id: "privacy", ok: false, message: "street address" },
      { id: "which-rating", ok: false, message: "confirm Which? rating" },
    ];
    expect(approvalBlockers(checks).map((c) => c.id)).toEqual(["consent-photos", "privacy"]);
  });
  it("bulk approve skips any failing check and says why", () => {
    expect(bulkSkipReason({ status: "in_review", checks: [{ id: "which-rating", ok: false, message: "Confirm the Which? rating" }] })).toBe(
      "Confirm the Which? rating",
    );
    expect(bulkSkipReason({ status: "in_review", checks: [{ id: "thin-input", ok: false, message: "" }] })).toBe("thin-input");
    expect(bulkSkipReason({ status: "approved", checks: [] })).toBe("already approved");
    expect(bulkSkipReason({ status: "in_review", checks: [{ id: "x", ok: true, message: "" }] })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Media privacy (P0-2)
// ---------------------------------------------------------------------------

describe("mediaPrivacy", () => {
  const img = {
    kind: "image" as const,
    publicKey: "t/j/after-1.public.jpg",
    blurredKey: null,
    privacyClearedAt: null,
    qualityNotes: null as string | null,
    qualityScore: 0.9 as number | null,
    tags: [] as string[],
  };
  it("withholds flagged photos with the reason", () => {
    const v = mediaPrivacy({ ...img, qualityNotes: "needs blur (neighbour's window); slightly dark" });
    expect(v).toMatchObject({ kind: "withheld", reason: "neighbour's window", publicKey: null });
    expect(needsPrivacyDecision({ ...img, qualityNotes: "needs blur" })).toBe(true);
  });
  it("uses the blurred copy, or the cleared copy, once resolved", () => {
    const flagged = { ...img, qualityNotes: "needs blur: house number" };
    expect(mediaPrivacy({ ...flagged, blurredKey: "t/j/after-1.blur.jpg" })).toMatchObject({ kind: "blurred", publicKey: "t/j/after-1.blur.jpg" });
    expect(mediaPrivacy({ ...flagged, privacyClearedAt: new Date() })).toMatchObject({ kind: "cleared", publicKey: img.publicKey });
    expect(mediaPrivacy({ ...flagged, tags: [KEPT_WITHHELD_TAG] }).kind).toBe("kept_withheld");
    expect(needsPrivacyDecision({ ...flagged, tags: [KEPT_WITHHELD_TAG] })).toBe(false);
  });
  it("marks never-screened photos and keeps voice notes private", () => {
    expect(mediaPrivacy({ ...img, qualityScore: null }).kind).toBe("not_checked");
    expect(mediaPrivacy({ ...img, qualityNotes: "unassessed" }).kind).toBe("not_checked");
    expect(mediaPrivacy({ ...img }).kind).toBe("clear");
    expect(mediaPrivacy({ ...img, kind: "audio" })).toMatchObject({ kind: "private", publicKey: null });
  });
  it("extracts a readable blur reason", () => {
    expect(blurReason("needs blur")).toBe("faces, number plates or house numbers");
    expect(blurReason("slightly dark")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Lead attribution (QA B2)
// ---------------------------------------------------------------------------

describe("lead attribution", () => {
  it("parses first/last touch tolerantly", () => {
    const a = parseAttribution({ first: { source: "facebook", medium: "paid_social", ts: 1_700_000_000_000 }, last: { source: "google", landingPage: "/contact/" } });
    expect(a.first).toMatchObject({ source: "facebook", medium: "paid_social" });
    expect(a.first?.at?.getTime()).toBe(1_700_000_000_000);
    expect(a.last).toMatchObject({ source: "google", landingPage: "/contact/" });
    expect(parseAttribution(null)).toEqual({ first: null, last: null });
    expect(parseAttribution({ first: 3, last: {} })).toEqual({ first: null, last: null });
  });
  it("finds asset ids from utm_content in any touch", () => {
    expect(assetIdFromUtmContent("asset_ast_ttXze_cH5bKbmnCR")).toBe("ast_ttXze_cH5bKbmnCR");
    expect(assetIdFromUtmContent("has space")).toBeNull();
    expect(
      leadAssetCandidates({ assetId: null, content: "asset_col", attribution: { first: { content: "asset_first" }, last: { content: "asset_last" } } }),
    ).toEqual(["first", "last", "col"]);
  });
  it("summarises enquiries by content type", () => {
    const kinds = [
      leadContentKind("portfolio_page", true),
      leadContentKind(null, true),
      leadContentKind("video", false),
      leadContentKind("video", false),
      leadContentKind("ad_copy", false),
      leadContentKind(null, false),
    ];
    const b = contentBreakdown(kinds);
    expect(b.map((x) => [x.kind, x.count])).toEqual([
      ["portfolio_page", 2],
      ["video", 2],
      ["ad_copy", 1],
      ["none", 1],
    ]);
    expect(breakdownSentence(b)).toBe("2 enquiries from portfolio pages, 2 from video ads, 1 from a text ad");
    expect(breakdownSentence(contentBreakdown(["none"]))).toMatch(/No enquiries traced/);
  });
  it("labels attributed videos by template and ratio", () => {
    expect(attributedAssetLabel({ type: "video", title: "x", content: { template: "reveal", ratio: "9:16" } })).toBe("Reveal video · 9:16");
    expect(attributedAssetLabel({ type: "ad_copy", title: "Ad copy — craft angle", content: {} })).toBe("Ad copy — craft angle");
  });
});

// ---------------------------------------------------------------------------
// Consent wording (P0-3 / P1-8)
// ---------------------------------------------------------------------------

describe("parseConsentWording", () => {
  it("maps the stored evidence to the four permissions with the exact statements", () => {
    const wording = consentWording("Thorburn Landscapes", "Wimbledon", {
      consentPhotos: true,
      consentArea: true,
      consentFirstName: false,
      consentQuote: true,
    });
    const { lines, other } = parseConsentWording(wording);
    expect(lines.consentPhotos).toMatchObject({ answer: true, title: "Photos of your garden" });
    expect(lines.consentArea?.statement).toContain('"Wimbledon"');
    expect(lines.consentFirstName).toMatchObject({ answer: false, title: "Your first name" });
    expect(lines.consentQuote?.statement).toMatch(/may quote my words/);
    expect(other).toHaveLength(1); // the address reassurance
  });
  it("copes with older three-item wording and no wording", () => {
    const { lines } = parseConsentWording("[YES] Photos of your garden: ok\n[NO] Your area: no");
    expect(lines.consentQuote).toBeUndefined();
    expect(parseConsentWording(null).lines).toEqual({});
  });
});
