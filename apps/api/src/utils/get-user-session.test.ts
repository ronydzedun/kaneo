import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  hasAccess: vi.fn(),
}));
vi.mock("../auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("../oidc/has-external-access", () => ({
  hasExternalAccess: mocks.hasAccess,
}));

import { getUserSession } from "./get-user-session";

describe("getUserSession", () => {
  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.hasAccess.mockReset();
  });

  it("denies a session when external access has expired or been revoked", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "user" },
      session: { id: "session" },
    });
    mocks.hasAccess.mockResolvedValue(false);
    expect(await getUserSession(new Headers())).toBeNull();
    expect(mocks.hasAccess).toHaveBeenCalledWith("user", "session");
  });

  it("preserves an allowed session and does not forward an API key", async () => {
    const session = { user: { id: "user" }, session: { id: "session" } };
    mocks.getSession.mockResolvedValue(session);
    mocks.hasAccess.mockResolvedValue(true);
    expect(await getUserSession(new Headers({ "x-api-key": "secret" }))).toBe(
      session,
    );
    expect(mocks.getSession.mock.calls[0]?.[0].headers.has("x-api-key")).toBe(
      false,
    );
  });

  it("does not query access without a session", async () => {
    mocks.getSession.mockResolvedValue(null);
    expect(await getUserSession(new Headers())).toBeNull();
    expect(mocks.hasAccess).not.toHaveBeenCalled();
  });
});
