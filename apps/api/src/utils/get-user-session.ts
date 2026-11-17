import { auth } from "../auth";
import { hasExternalAccess } from "../oidc/has-external-access";

export async function getUserSession(headers: Headers) {
  const sessionHeaders = new Headers(headers);
  sessionHeaders.delete("x-api-key");
  const session = await auth.api.getSession({ headers: sessionHeaders });
  if (
    session &&
    !(await hasExternalAccess(session.user.id, session.session.id))
  )
    return null;
  return session;
}
