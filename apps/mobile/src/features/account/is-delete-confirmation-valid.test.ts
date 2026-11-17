import { describe, expect, it } from "vite-plus/test";

import { isDeleteConfirmationValid } from "./is-delete-confirmation-valid";

describe("isDeleteConfirmationValid", () => {
  it("accepts the email ignoring case and surrounding spaces", () => {
    expect(
      isDeleteConfirmationValid("  Ada@Example.com ", "ada@example.com"),
    ).toBe(true);
  });

  it("rejects a different email", () => {
    expect(
      isDeleteConfirmationValid("ada@example.org", "ada@example.com"),
    ).toBe(false);
  });

  it("requires DELETE when the account has no email", () => {
    expect(isDeleteConfirmationValid("", undefined)).toBe(false);
    expect(isDeleteConfirmationValid("", "")).toBe(false);
    expect(isDeleteConfirmationValid("delete", null)).toBe(true);
  });
});
