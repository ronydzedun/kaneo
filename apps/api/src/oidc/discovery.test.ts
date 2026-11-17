import { describe, expect, it } from "vite-plus/test";
import { parseDiscovery } from "./discovery";

const issuer = "https://id.example";
const document = {
  issuer,
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: `${issuer}/token`,
  jwks_uri: `${issuer}/jwks`,
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["S256"],
  id_token_signing_alg_values_supported: ["RS256", "HS256"],
};

describe("parseDiscovery", () => {
  it("pins the issuer and accepts advertised asymmetric signing", () => {
    expect(parseDiscovery(document, issuer)).toMatchObject({
      issuer,
      algorithms: ["RS256"],
    });
  });

  it.each([
    { issuer: "https://other.example" },
    { token_endpoint: "http://id.example/token" },
    { jwks_uri: "https://user:password@id.example/jwks" },
    { code_challenge_methods_supported: ["plain"] },
    { response_types_supported: ["token"] },
    { id_token_signing_alg_values_supported: ["HS256"] },
  ])("rejects unsafe or incompatible metadata: %o", (change) => {
    expect(() => parseDiscovery({ ...document, ...change }, issuer)).toThrow();
  });
});
