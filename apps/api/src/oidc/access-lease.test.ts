import { describe, expect, it } from "vite-plus/test";
import { hasCurrentAccess } from "./access-lease";

describe("hasCurrentAccess", () => {
  const now = new Date("2026-11-17T00:00:00Z");

  it("allows only an explicit grant with an unexpired lease", () => {
    expect(
      hasCurrentAccess(
        { accessGranted: true, accessValidUntil: new Date(now.getTime() + 1) },
        now,
      ),
    ).toBe(true);
  });

  it.each([
    { accessGranted: false, accessValidUntil: new Date(now.getTime() + 1) },
    { accessGranted: true, accessValidUntil: null },
    { accessGranted: true, accessValidUntil: now },
    { accessGranted: true, accessValidUntil: new Date(Number.NaN) },
  ])("denies absent, expired or revoked access", (lease) => {
    expect(hasCurrentAccess(lease, now)).toBe(false);
  });
});
