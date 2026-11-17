import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  provision: vi.fn(),
  synchronize: vi.fn(),
}));
vi.mock("./sync-config", () => ({ getSyncConfig: mocks.config }));
vi.mock("./provision-external-identity", () => ({
  provisionExternalIdentity: mocks.provision,
}));
vi.mock("./synchronize-external-access", () => ({
  synchronizeExternalAccess: mocks.synchronize,
  ExternalAccessRevisionConflict: class extends Error {},
}));
import syncApi from "./sync-route";

const secret = "test-secret-at-least-thirty-two-bytes";
const body = { subject: "opaque", name: "User", revision: 1, granted: false };
const request = (authorization?: string, data = body) =>
  syncApi.request("/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(data),
  });

describe("external identity synchronization route", () => {
  beforeEach(() => {
    mocks.config.mockReturnValue({ issuer: "https://id.example", secret });
    mocks.provision.mockReset();
    mocks.synchronize.mockReset();
    mocks.provision.mockResolvedValue({ userId: "user", created: true });
    mocks.synchronize.mockResolvedValue({ userId: "user", status: "applied" });
  });

  it("rejects missing or wrong machine credentials before provisioning", async () => {
    expect((await request()).status).toBe(401);
    expect((await request("Bearer wrong")).status).toBe(401);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("does not expose the endpoint when synchronization is disabled", async () => {
    mocks.config.mockReturnValue(null);
    expect((await request(`Bearer ${secret}`)).status).toBe(404);
  });

  it("uses the configured issuer and applies the access revision", async () => {
    const response = await request(`Bearer ${secret}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      userId: "user",
      created: true,
      status: "applied",
    });
    expect(mocks.provision).toHaveBeenCalledWith({
      issuer: "https://id.example",
      subject: "opaque",
      name: "User",
    });
    expect(mocks.synchronize).toHaveBeenCalledWith({
      issuer: "https://id.example",
      ...body,
    });
  });

  it("does not acknowledge an outdated revision", async () => {
    mocks.synchronize.mockResolvedValue({ userId: "user", status: "stale" });
    expect((await request(`Bearer ${secret}`)).status).toBe(409);
  });
});
