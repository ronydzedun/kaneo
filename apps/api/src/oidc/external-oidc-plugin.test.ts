import { createHash } from "node:crypto";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { APIError } from "better-auth/api";
import { admin } from "better-auth/plugins";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

const mocks = vi.hoisted(() => ({ projections: vi.fn() }));
vi.mock("../database", async () => ({
  default: {
    select: () => ({
      from: () => ({ where: () => ({ limit: mocks.projections }) }),
    }),
  },
  schema: await import("../database/schema"),
}));

import { externalOidcPlugin } from "./external-oidc-plugin";

const issuer = "https://id.example";
const config = {
  issuer,
  clientId: "client",
  clientSecret: "client-secret",
  callback: "http://localhost:3000/api/auth/external-oidc/callback",
  clientUrl: "http://localhost:5173/",
};

describe("external OIDC sign-in", () => {
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  let jwk: Awaited<ReturnType<typeof exportJWK>>;
  let nonce = "";
  let challenge = "";
  let allow = true;
  let badNonce = false;
  let user: Record<string, unknown>;
  let sessionRows: Record<string, unknown>[];
  let auth: { handler(request: Request): Promise<Response> };

  beforeAll(async () => {
    const keys = await generateKeyPair("RS256");
    privateKey = keys.privateKey;
    jwk = { ...(await exportJWK(keys.publicKey)), kid: "key" };
  });

  beforeEach(() => {
    nonce = "";
    challenge = "";
    allow = true;
    badNonce = false;
    user = {
      id: "user",
      name: "User",
      email: null,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: "user",
      banned: false,
    };
    mocks.projections.mockResolvedValue([{ userId: "user" }]);
    sessionRows = [];
    const database = {
      user: [user],
      session: sessionRows,
      account: [],
      verification: [],
    };
    auth = betterAuth({
      baseURL: "http://localhost:3000",
      trustedOrigins: ["http://localhost:5173"],
      secret: "test-only-secret-long-enough-for-better-auth",
      database: memoryAdapter(database),
      plugins: [admin(), externalOidcPlugin(config)],
      session: {
        additionalFields: {
          oidcIssuer: { type: "string", required: false, input: false },
          oidcSid: { type: "string", required: false, input: false },
        },
      },
      databaseHooks: {
        session: {
          create: {
            before: async () => {
              if (!allow)
                throw new APIError("FORBIDDEN", { message: "Access denied" });
            },
          },
        },
      },
      rateLimit: { enabled: false },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (String(url).endsWith("/.well-known/openid-configuration")) {
          return Response.json({
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            jwks_uri: `${issuer}/jwks`,
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"],
            id_token_signing_alg_values_supported: ["RS256"],
          });
        }
        if (String(url) === `${issuer}/jwks`)
          return Response.json({ keys: [jwk] });
        if (String(url) === `${issuer}/token`) {
          const form = new URLSearchParams(String(init?.body));
          expect(
            createHash("sha256")
              .update(form.get("code_verifier")!)
              .digest("base64url"),
          ).toBe(challenge);
          expect(form.get("redirect_uri")).toBe(config.callback);
          const token = await new SignJWT({
            nonce: badNonce ? "wrong" : nonce,
            sid: "provider-session",
          })
            .setProtectedHeader({ alg: "RS256", kid: "key" })
            .setIssuer(issuer)
            .setSubject("opaque")
            .setAudience(config.clientId)
            .setIssuedAt()
            .setExpirationTime("5m")
            .sign(privateKey);
          return Response.json({ id_token: token, token_type: "Bearer" });
        }
        throw new Error("Unexpected request");
      }),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  async function start() {
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/external-oidc/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:5173",
        },
        body: JSON.stringify({ returnTo: "/dashboard" }),
      }),
    );
    expect(response.status).toBe(200);
    const url = new URL((await response.json()).url);
    nonce = url.searchParams.get("nonce")!;
    challenge = url.searchParams.get("code_challenge")!;
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("openid profile");
    const cookie = response.headers
      .getSetCookie()
      .map((part) => part.split(";")[0])
      .join("; ");
    return { state: url.searchParams.get("state")!, cookie };
  }

  async function callback(state: string, cookie: string) {
    const url = new URL(config.callback);
    url.searchParams.set("code", "one-time-code");
    url.searchParams.set("state", state);
    return auth.handler(new Request(url, { headers: { cookie } }));
  }

  it("creates a Better Auth session for a verified user without email", async () => {
    const { state, cookie } = await start();
    const response = await callback(state, cookie);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `${config.clientUrl}dashboard`,
    );
    const sessionCookie = response.headers
      .getSetCookie()
      .map((part) => part.split(";")[0])
      .join("; ");
    const session = await auth.handler(
      new Request("http://localhost:3000/api/auth/get-session", {
        headers: { cookie: sessionCookie },
      }),
    );
    expect((await session.json()).user.email).toBeNull();
    expect(sessionRows[0]).toMatchObject({
      oidcIssuer: issuer,
      oidcSid: "provider-session",
    });
  });

  it("rejects a mismatched state", async () => {
    const { cookie } = await start();
    const response = await callback("wrong-state", cookie);
    expect(response.headers.get("location")).not.toBe(
      `${config.clientUrl}dashboard`,
    );
  });

  it("rejects a mismatched nonce", async () => {
    const { state, cookie } = await start();
    badNonce = true;
    const response = await callback(state, cookie);
    expect(response.status).toBe(400);
  });

  it("honors access denial and the independent administrative ban", async () => {
    let flow = await start();
    allow = false;
    expect((await callback(flow.state, flow.cookie)).status).toBe(403);
    allow = true;
    user.banned = true;
    flow = await start();
    expect((await callback(flow.state, flow.cookie)).status).toBe(403);
  });
});
