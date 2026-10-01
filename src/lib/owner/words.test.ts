import { describe, expect, it } from "vitest";
import { ago, greeting, jobStatusLine, prettyPhone, when, whatsappLink } from "./words";

const now = new Date("2026-09-24T11:00:00Z"); // Thu 12:00 BST

describe("plain words", () => {
  it("greets by the time of day in London", () => {
    expect(greeting(new Date("2026-09-24T06:30:00Z"), "Stephen")).toBe("Good morning, Stephen");
    expect(greeting(new Date("2026-09-24T12:30:00Z"))).toBe("Good afternoon");
    expect(greeting(new Date("2026-09-24T18:30:00Z"), "Stephen")).toBe("Good evening, Stephen");
  });

  it("says how long ago, the way people do", () => {
    expect(ago(new Date(now.getTime() - 20_000), now)).toBe("just now");
    expect(ago(new Date(now.getTime() - 5 * 60_000), now)).toBe("5 min ago");
    expect(ago(new Date(now.getTime() - 2 * 3600_000), now)).toBe("2 hours ago");
    expect(ago(new Date("2026-09-23T15:00:00Z"), now)).toBe("yesterday");
    expect(ago(new Date("2026-09-18T15:00:00Z"), now)).toBe("6 days ago");
    expect(ago(new Date("2026-08-30T15:00:00Z"), now)).toBe("3 weeks ago");
  });

  it("says when, relative to today", () => {
    expect(when(new Date("2026-09-24T15:00:00Z"), now)).toBe("today at 16:00");
    expect(when(new Date("2026-09-25T09:00:00Z"), now)).toBe("tomorrow at 10:00");
    expect(when(new Date("2026-09-28T07:00:00Z"), now)).toBe("Monday at 08:00");
    expect(when(new Date("2026-10-06T11:00:00Z"), now)).toBe("Tue 6 Oct");
  });

  it("describes a job in one line per stage", () => {
    const line = (stage: Parameters<typeof jobStatusLine>[0]["stage"], extra: Partial<Parameters<typeof jobStatusLine>[0]> = {}) =>
      jobStatusLine({ stage, stageSince: new Date("2026-09-18T11:00:00Z"), nextActionAt: null, ...extra }, now);
    expect(line("quoted")).toBe("Quote sent 6 days ago");
    expect(line("site_visit", { nextActionAt: new Date("2026-09-25T09:00:00Z") })).toBe("Site visit tomorrow at 10:00");
    expect(line("site_visit")).toBe("Site visit to arrange");
    expect(line("booked", { nextActionAt: new Date("2026-09-28T07:00:00Z") })).toBe("Starts Monday at 08:00");
    expect(line("on_site")).toBe("On site · day 7");
    expect(line("finished", { reviewAsked: true })).toBe("Finished 6 days ago · review asked");
    expect(line("finished", { reviewRating: 5 })).toBe("Finished 6 days ago · rated 5★");
    expect(line("maintenance", { nextActionAt: new Date("2026-09-26T08:00:00Z") })).toBe("Next visit Saturday at 09:00");
    expect(line("lost")).toBe("Didn't go ahead · 6 days ago");
  });

  it("formats phones for people and WhatsApp", () => {
    expect(prettyPhone("+447700900101")).toBe("07700 900101");
    expect(prettyPhone(null)).toBeNull();
    expect(whatsappLink("+447700900101", "Hi Amelia")).toBe("https://wa.me/447700900101?text=Hi%20Amelia");
  });
});
