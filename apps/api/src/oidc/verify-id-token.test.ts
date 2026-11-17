import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { verifyIdToken, type IdTokenVerification } from "./verify-id-token";

describe("verifyIdToken", () => {
  let sign: (claims?: Record<string, unknown>) => Promise<string>;
  let options: IdTokenVerification;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const key = await exportJWK(publicKey);
    key.kid = "test";
    const now = Math.floor(Date.now() / 1000);
    options = {
      issuer: "https://identity.example",
      clientId: "kaneo",
      nonce: "test-nonce",
      algorithms: ["RS256"],
      getKey: createLocalJWKSet({ keys: [key] }),
    };
    sign = (claims = {}) =>
      new SignJWT({
        iss: options.issuer,
        sub: "opaque-subject",
        aud: options.clientId,
        exp: now + 300,
        iat: now,
        nonce: options.nonce,
        ...claims,
      })
        .setProtectedHeader({ alg: "RS256", kid: "test" })
        .sign(privateKey);
  });

  it("accepts a signed identity without email", async () => {
    const identity = await verifyIdToken(await sign(), options);
    expect(identity.subject).toBe("opaque-subject");
    expect(identity.issuer).toBe(options.issuer);
    expect(identity.claims.email).toBeUndefined();
  });

  it.each([
    ["issuer", { iss: "https://other.example" }],
    ["audience", { aud: "other" }],
    ["nonce", { nonce: "other" }],
    ["subject", { sub: "" }],
    ["expiry", { exp: 1 }],
    ["future issued-at", { iat: 4102444800 }],
    [
      "multiple audiences without authorized party",
      { aud: ["kaneo", "other"] },
    ],
    ["wrong authorized party", { azp: "other" }],
  ])("rejects invalid %s", async (_name, claims) => {
    await expect(verifyIdToken(await sign(claims), options)).rejects.toThrow();
  });

  it("rejects a signature from another key", async () => {
    const { publicKey } = await generateKeyPair("RS256");
    const key = await exportJWK(publicKey);
    key.kid = "test";
    await expect(
      verifyIdToken(await sign(), {
        ...options,
        getKey: createLocalJWKSet({ keys: [key] }),
      }),
    ).rejects.toThrow();
  });
});
