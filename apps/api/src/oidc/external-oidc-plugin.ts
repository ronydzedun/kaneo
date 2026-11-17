import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { generateState, parseState } from "better-auth/oauth2";
import { z } from "zod";
import db, { schema } from "../database";
import type { getExternalOidcConfig } from "./login-config";
import {
  discoverExternalProvider,
  exchangeExternalCode,
  pkceChallenge,
} from "./provider";

type Config = NonNullable<ReturnType<typeof getExternalOidcConfig>>;

function resolveReturnUrl(value: string, clientUrl: string) {
  try {
    const destination = new URL(value, clientUrl);
    if (destination.origin === new URL(clientUrl).origin)
      return destination.href;
  } catch {}
  throw new APIError("BAD_REQUEST", { message: "Invalid return path" });
}

export function externalOidcPlugin(config: Config) {
  return {
    id: "external-oidc",
    endpoints: {
      startExternalOidc: createAuthEndpoint(
        "/external-oidc/start",
        {
          method: "POST",
          body: z.object({ returnTo: z.string().max(2048).optional() }),
        },
        async (ctx) => {
          const provider = await discoverExternalProvider(config.issuer);
          const nonce = randomBytes(32).toString("base64url");
          const destination = resolveReturnUrl(
            ctx.body.returnTo || "/",
            config.clientUrl,
          );
          const { state, codeVerifier } = await generateState(ctx, {
            idTokenNonce: nonce,
            additionalData: { externalReturnTo: destination },
          });
          const url = new URL(provider.authorizationEndpoint);
          url.searchParams.set("response_type", "code");
          url.searchParams.set("client_id", config.clientId);
          url.searchParams.set("redirect_uri", config.callback);
          url.searchParams.set("scope", "openid profile");
          url.searchParams.set("state", state);
          url.searchParams.set("nonce", nonce);
          url.searchParams.set("code_challenge", pkceChallenge(codeVerifier));
          url.searchParams.set("code_challenge_method", "S256");
          return ctx.json({ url: url.href });
        },
      ),
      callbackExternalOidc: createAuthEndpoint(
        "/external-oidc/callback",
        {
          method: "GET",
          query: z.object({
            code: z.string().min(1).max(4096),
            state: z.string().min(1).max(512),
          }),
        },
        async (ctx) => {
          const state = await parseState(ctx);
          if (!state.idTokenNonce) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid OIDC state",
            });
          }
          let identity: Awaited<ReturnType<typeof exchangeExternalCode>>;
          try {
            identity = await exchangeExternalCode(
              config,
              ctx.query.code,
              state.codeVerifier,
              state.idTokenNonce,
            );
          } catch {
            throw new APIError("BAD_REQUEST", {
              message: "OIDC authentication failed",
            });
          }
          const [projection] = await db
            .select({ userId: schema.externalIdentityTable.userId })
            .from(schema.externalIdentityTable)
            .where(
              and(
                eq(schema.externalIdentityTable.issuer, identity.issuer),
                eq(schema.externalIdentityTable.subject, identity.subject),
              ),
            )
            .limit(1);
          if (!projection)
            throw new APIError("FORBIDDEN", { message: "Access denied" });
          const user = await ctx.context.internalAdapter.findUserById(
            projection.userId,
          );
          if (!user)
            throw new APIError("FORBIDDEN", { message: "Access denied" });
          const sid = identity.claims.sid;
          const session = await ctx.context.internalAdapter.createSession(
            user.id,
            false,
            {
              oidcIssuer: identity.issuer,
              ...(typeof sid === "string" && sid ? { oidcSid: sid } : {}),
            },
          );
          if (!session)
            throw new APIError("FORBIDDEN", { message: "Access denied" });
          await setSessionCookie(ctx, { user, session });
          const destination =
            typeof state.externalReturnTo === "string"
              ? state.externalReturnTo
              : config.clientUrl;
          throw ctx.redirect(resolveReturnUrl(destination, config.clientUrl));
        },
      ),
    },
  };
}
