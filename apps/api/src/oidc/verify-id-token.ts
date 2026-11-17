import { jwtVerify, type JWTVerifyGetKey } from "jose";

const supportedAlgorithms = new Set([
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
]);

export type IdTokenVerification = {
  issuer: string;
  clientId: string;
  nonce: string;
  algorithms: string[];
  getKey: JWTVerifyGetKey;
};

/**
 * Verify the identity in an OIDC ID token. The caller must obtain issuer,
 * algorithms and keys from a trusted, issuer-checked discovery document.
 */
export async function verifyIdToken(
  token: string,
  options: IdTokenVerification,
) {
  if (
    !options.nonce ||
    !options.issuer ||
    !options.clientId ||
    !options.algorithms.length ||
    options.algorithms.some((algorithm) => !supportedAlgorithms.has(algorithm))
  ) {
    throw new Error("OIDC verification configuration is incomplete");
  }
  const { payload } = await jwtVerify(token, options.getKey, {
    issuer: options.issuer,
    audience: options.clientId,
    algorithms: options.algorithms,
    requiredClaims: ["iss", "sub", "aud", "exp", "iat", "nonce"],
    clockTolerance: 60,
  });
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("OIDC subject is missing");
  }
  if (payload.nonce !== options.nonce) {
    throw new Error("OIDC nonce does not match");
  }
  if (typeof payload.iat !== "number" || payload.iat > Date.now() / 1000 + 60) {
    throw new Error("OIDC issued-at time is invalid");
  }
  if (
    (Array.isArray(payload.aud) && payload.aud.length > 1 && !payload.azp) ||
    (payload.azp !== undefined && payload.azp !== options.clientId)
  ) {
    throw new Error("OIDC authorized party does not match");
  }
  return { issuer: options.issuer, subject: payload.sub, claims: payload };
}
