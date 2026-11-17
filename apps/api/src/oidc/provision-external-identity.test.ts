import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("../database", async () => ({
  default: { transaction: mocks.transaction },
  schema: await import("../database/schema"),
}));

import { provisionExternalIdentity } from "./provision-external-identity";

describe("provisionExternalIdentity", () => {
  const identity = {
    issuer: "https://id.example",
    subject: "sub",
    name: "Alice",
  };

  beforeEach(() => {
    mocks.transaction.mockReset();
  });

  it("creates a denied user without email or credentials", async () => {
    const userValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: "new-user" }]),
    });
    const identityValues = vi.fn().mockResolvedValue(undefined);
    const insert = vi
      .fn()
      .mockReturnValueOnce({ values: userValues })
      .mockReturnValueOnce({ values: identityValues });
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [] }) }),
      }),
      insert,
    };
    mocks.transaction.mockImplementation((run) => run(tx));

    await expect(provisionExternalIdentity(identity)).resolves.toEqual({
      userId: "new-user",
      created: true,
    });
    expect(userValues).toHaveBeenCalledWith({
      name: "Alice",
      email: null,
      emailVerified: false,
      isAnonymous: false,
      role: "user",
    });
    expect(identityValues).toHaveBeenCalledWith({
      issuer: identity.issuer,
      subject: identity.subject,
      userId: "new-user",
    });
  });

  it("reuses only the existing issuer and subject projection", async () => {
    const tx = {
      execute: vi.fn().mockResolvedValue(undefined),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ userId: "existing-user" }],
          }),
        }),
      }),
      insert: vi.fn(),
    };
    mocks.transaction.mockImplementation((run) => run(tx));
    await expect(provisionExternalIdentity(identity)).resolves.toEqual({
      userId: "existing-user",
      created: false,
    });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("rejects an empty subject before opening a transaction", async () => {
    await expect(
      provisionExternalIdentity({ ...identity, subject: "" }),
    ).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
