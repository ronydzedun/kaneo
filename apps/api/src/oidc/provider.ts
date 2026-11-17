import { createHash } from "node:crypto";
import { createLocalJWKSet, type JSONWebKeySet } from "jose";
import {
  fetchProviderJson,
  MAX_PROVIDER_DOCUMENT_BYTES,
} from "../backchannel-logout/fetch-provider-json";
import { parseDiscovery } from "./discovery";
import { verifyIdToken } from "./verify-id-token";
import type { getExternalOidcConfig } from "./login-config";

type Config = NonNullable<ReturnType<typeof getExternalOidcConfig>>;

export async function discoverExternalProvider(issuer: string) {
  const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  return parseDiscovery(await fetchProviderJson(url), issuer);
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function formEncode(value: string) {
  return new URLSearchParams({ value }).toString().slice("value=".length);
}

export async function exchangeExternalCode(
  config: Config,
  code: string,
  verifier: string,
  nonce: string,
) {
  const provider = await discoverExternalProvider(config.issuer);
  const credentials = Buffer.from(
    `${formEncode(config.clientId)}:${formEncode(config.clientSecret)}`,
  ).toString("base64");
  const response = await fetch(provider.tokenEndpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.callback,
      code_verifier: verifier,
    }),
  });
  if (!response.ok || !response.body)
    throw new Error("OIDC token exchange failed");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_PROVIDER_DOCUMENT_BYTES)
        throw new Error("OIDC token response is too large");
      chunks.push(value);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const tokenResponse: unknown = JSON.parse(
    Buffer.concat(chunks).toString("utf8"),
  );
  if (
    !tokenResponse ||
    typeof tokenResponse !== "object" ||
    !("id_token" in tokenResponse) ||
    typeof tokenResponse.id_token !== "string" ||
    tokenResponse.id_token.length > 32768
  ) {
    throw new Error("OIDC token response has no ID token");
  }
  const jwks = await fetchProviderJson(provider.jwksUri);
  if (
    !jwks ||
    typeof jwks !== "object" ||
    !("keys" in jwks) ||
    !Array.isArray(jwks.keys)
  ) {
    throw new Error("OIDC provider returned invalid keys");
  }
  return verifyIdToken(tokenResponse.id_token, {
    issuer: config.issuer,
    clientId: config.clientId,
    nonce,
    algorithms: provider.algorithms,
    getKey: createLocalJWKSet(jwks as JSONWebKeySet),
  });
}
