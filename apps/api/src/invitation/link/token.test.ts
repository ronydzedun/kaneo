import { describe, expect, it } from "vite-plus/test";
import { createInvitationLinkToken, invitationLinkTokenHash } from "./token";

describe("invitation link tokens", () => {
  it("generates random opaque tokens and stores only their hash", () => {
    const token = createInvitationLinkToken();
    const other = createInvitationLinkToken();
    expect(token).not.toBe(other);
    expect(invitationLinkTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(invitationLinkTokenHash(token)).not.toBe(token);
    expect(invitationLinkTokenHash(token)).not.toBe(
      invitationLinkTokenHash(other),
    );
  });

  it("rejects malformed tokens", () => {
    expect(invitationLinkTokenHash("short")).toBeNull();
    expect(invitationLinkTokenHash("!".repeat(43))).toBeNull();
  });
});
