import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  hasAccess: vi.fn(),
}));
vi.mock("../auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("./has-external-access", () => ({
  hasExternalAccess: mocks.hasAccess,
}));

import { nativeExternalAccessGuard } from "./native-external-access-guard";

describe("nativeExternalAccessGuard", () => {
  const app = new Hono();
  app.use("/auth/*", nativeExternalAccessGuard);
  app.all("/auth/*", (c) => c.text("forwarded"));

  beforeEach(() => {
    mocks.getSession.mockReset();
    mocks.hasAccess.mockReset();
  });

  it("blocks a revoked user's native organization operation", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "user" },
      session: { id: "session" },
    });
    mocks.hasAccess.mockResolvedValue(false);
    const response = await app.request("/auth/organization/list", {
      headers: { authorization: "Bearer session" },
    });
    expect(response.status).toBe(403);
  });

  it("returns a null session after revocation", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "user" },
      session: { id: "session" },
    });
    mocks.hasAccess.mockResolvedValue(false);
    const response = await app.request("/auth/get-session", {
      headers: { cookie: "session=value" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it("allows sign-out without resolving a revoked session", async () => {
    const response = await app.request("/auth/sign-out", {
      method: "POST",
      headers: { cookie: "session=value" },
    });
    expect(await response.text()).toBe("forwarded");
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("forwards allowed sessions without passing an API key to session lookup", async () => {
    mocks.getSession.mockResolvedValue({
      user: { id: "user" },
      session: { id: "session" },
    });
    mocks.hasAccess.mockResolvedValue(true);
    const response = await app.request("/auth/organization/list", {
      headers: { cookie: "session=value", "x-api-key": "secret" },
    });
    expect(await response.text()).toBe("forwarded");
    expect(mocks.getSession.mock.calls[0]?.[0].headers.has("x-api-key")).toBe(
      false,
    );
  });
});
