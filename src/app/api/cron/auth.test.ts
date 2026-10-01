import { describe, expect, it } from "vitest";
import { isAuthorised } from "./auth";

describe("cron bearer check", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorised("Bearer s3cret", "s3cret")).toBe(true);
    expect(isAuthorised("Bearer s3cre", "s3cret")).toBe(false);
    expect(isAuthorised("s3cret", "s3cret")).toBe(false);
    expect(isAuthorised(null, "s3cret")).toBe(false);
  });
});
