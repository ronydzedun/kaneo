import { afterEach, describe, expect, it } from "vite-plus/test";
import { getExternalOidcConfig } from "./login-config";

const keys = [
  "EXTERNAL_IDENTITY_ISSUER",
  "EXTERNAL_OIDC_CLIENT_ID",
  "EXTERNAL_OIDC_CLIENT_SECRET",
  "KANEO_API_URL",
  "KANEO_CLIENT_URL",
] as const;

function configure(overrides: Record<string, string> = {}) {
  const values = {
    EXTERNAL_IDENTITY_ISSUER: "https://auth.example",
    EXTERNAL_OIDC_CLIENT_ID: "board",
    EXTERNAL_OIDC_CLIENT_SECRET: "secret",
    KANEO_API_URL: "https://board.example/api",
    KANEO_CLIENT_URL: "https://board.example/",
    ...overrides,
  };
  for (const key of keys) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
}

afterEach(() => {
  for (const key of keys) delete process.env[key];
});

describe("getExternalOidcConfig", () => {
  it("is disabled without a client", () => {
    configure({ EXTERNAL_OIDC_CLIENT_ID: "", EXTERNAL_OIDC_CLIENT_SECRET: "" });
    expect(getExternalOidcConfig()).toBeNull();
  });

  it("builds one callback path for bundled and split API URLs", () => {
    configure();
    expect(getExternalOidcConfig()?.callback).toBe(
      "https://board.example/api/auth/external-oidc/callback",
    );
    configure({ KANEO_API_URL: "https://api.board.example" });
    expect(getExternalOidcConfig()?.callback).toBe(
      "https://api.board.example/api/auth/external-oidc/callback",
    );
  });

  it("rejects an insecure issuer", () => {
    configure({ EXTERNAL_IDENTITY_ISSUER: "http://auth.example" });
    expect(() => getExternalOidcConfig()).toThrow();
  });
});
