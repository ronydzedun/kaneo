import { describe, expect, it, vi } from "vite-plus/test";
import { assertEmailDeliverable } from "./assert-email-deliverable";

vi.mock("@kaneo/email", () => ({ isSmtpConfigured: () => true }));

describe("assertEmailDeliverable", () => {
  const user = {
    id: "user",
    name: "User",
    email: null,
    emailVerified: false,
    image: null,
    locale: null,
    isAnonymous: false,
  };

  it("rejects an account without an email address", () => {
    expect(() => assertEmailDeliverable(user)).toThrow(
      "This account has no email address to send to.",
    );
  });

  it("accepts an account with an email address", () => {
    expect(() =>
      assertEmailDeliverable({ ...user, email: "user@example.com" }),
    ).not.toThrow();
  });
});
