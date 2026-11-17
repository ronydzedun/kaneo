import type { MiddlewareHandler } from "hono";
import { auth } from "../auth";
import { hasExternalAccess } from "./has-external-access";

/**
 * The Better Auth HTTP endpoints do not use Kaneo's API session middleware.
 * Check their real cookie or bearer session before forwarding the request.
 */
export const nativeExternalAccessGuard: MiddlewareHandler = async (c, next) => {
  if (
    c.req.path.endsWith("/sign-out") ||
    (!c.req.header("cookie") && !c.req.header("authorization"))
  ) {
    return next();
  }
  const headers = new Headers(c.req.raw.headers);
  headers.delete("x-api-key");
  const session = await auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  if (
    session?.user &&
    !(await hasExternalAccess(session.user.id, session.session.id))
  ) {
    if (c.req.path.endsWith("/get-session")) return c.json(null);
    return c.json(
      { code: "EXTERNAL_ACCESS_DENIED", message: "Access denied" },
      403,
    );
  }
  return next();
};
