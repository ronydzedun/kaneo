import type { Context, MiddlewareHandler } from "hono";
import { notFoundResponse } from "../errors/not-found-response";
import { resolveBackchannelLogoutConfig } from "./config";
import { endProviderSessions } from "./controllers/end-provider-sessions";
import { LogoutProviderUnavailable, LogoutTokenRejected } from "./errors";
import { providerJwks } from "./provider-jwks";
import { getProviderMetadata } from "./provider-metadata";
import { verifyLogoutToken } from "./verify-logout-token";
import { getExternalOidcConfig } from "../oidc/login-config";

export const MAX_LOGOUT_REQUEST_BYTES = 16 * 1024;

const COMPACT_JWS = /^[\w-]+\.[\w-]+\.[\w-]+$/;

export const noStore: MiddlewareHandler = async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "no-store");
};

async function readLogoutToken(c: Context) {
  const type = c.req
    .header("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (type !== "application/x-www-form-urlencoded") return null;
  const tokens = new URLSearchParams(await c.req.text()).getAll("logout_token");
  const [token] = tokens;
  return tokens.length === 1 && token && COMPACT_JWS.test(token) ? token : null;
}

async function loadLogoutTokenProvider(discoveryUrl: string) {
  const { issuer, algorithms, jwksUri } =
    await getProviderMetadata(discoveryUrl);
  return { issuer, algorithms, ...providerJwks(jwksUri) };
}

export async function handleBackchannelLogoutRoute(c: Context) {
  const config = resolveBackchannelLogoutConfig();
  if (!config.enabled) return notFoundResponse();
  return handleLogout(c, config.discoveryUrl, config.clientId);
}

export async function handleExternalBackchannelLogoutRoute(c: Context) {
  const config = getExternalOidcConfig();
  if (!config) return notFoundResponse();
  const discovery = `${config.issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  return handleLogout(c, discovery, config.clientId, config.issuer);
}

async function handleLogout(
  c: Context,
  discoveryUrl: string,
  clientId: string,
  expectedIssuer?: string,
) {
  const token = await readLogoutToken(c);
  if (!token) return c.json({ error: "invalid_request" }, 400);

  try {
    const claims = await verifyLogoutToken(token, clientId, async () => {
      const provider = await loadLogoutTokenProvider(discoveryUrl);
      if (expectedIssuer && provider.issuer !== expectedIssuer) {
        throw new LogoutProviderUnavailable(
          "the discovery issuer does not match",
        );
      }
      return provider;
    });
    if (expectedIssuer) {
      await endProviderSessions(claims, { externalOnly: true });
    } else {
      await endProviderSessions(claims);
    }
  } catch (error) {
    if (error instanceof LogoutProviderUnavailable) {
      console.warn(`Back-channel logout is unavailable: ${error.message}`);
      return c.json({ error: "temporarily_unavailable" }, 503);
    }
    if (error instanceof LogoutTokenRejected) {
      console.warn(`Rejected a back-channel logout token: ${error.message}`);
      return c.json({ error: "invalid_request" }, 400);
    }
    throw error;
  }

  return c.body(null, 200);
}
