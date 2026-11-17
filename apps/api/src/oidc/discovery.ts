const signingAlgorithms = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
];

function endpoint(value: unknown): string {
  if (typeof value !== "string") throw new Error("OIDC endpoint is missing");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(
      "OIDC endpoint must be an HTTPS URL without credentials or fragment",
    );
  }
  return value;
}

export function parseDiscovery(document: unknown, expectedIssuer: string) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("OIDC discovery document is invalid");
  }
  const fields = document as Record<string, unknown>;
  endpoint(expectedIssuer);
  if (new URL(expectedIssuer).search)
    throw new Error("OIDC issuer must not contain a query");
  if (fields.issuer !== expectedIssuer) throw new Error("OIDC issuer mismatch");
  if (
    !Array.isArray(fields.response_types_supported) ||
    !fields.response_types_supported.includes("code") ||
    !Array.isArray(fields.code_challenge_methods_supported) ||
    !fields.code_challenge_methods_supported.includes("S256")
  ) {
    throw new Error(
      "OIDC provider must support authorization code and PKCE S256",
    );
  }
  const algorithms = Array.isArray(fields.id_token_signing_alg_values_supported)
    ? signingAlgorithms.filter((algorithm) =>
        (fields.id_token_signing_alg_values_supported as unknown[]).includes(
          algorithm,
        ),
      )
    : [];
  if (!algorithms.length)
    throw new Error("OIDC provider has no supported signing algorithm");
  return {
    issuer: expectedIssuer,
    authorizationEndpoint: endpoint(fields.authorization_endpoint),
    tokenEndpoint: endpoint(fields.token_endpoint),
    jwksUri: endpoint(fields.jwks_uri),
    algorithms,
  };
}
