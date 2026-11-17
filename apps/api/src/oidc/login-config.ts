import { resolveFileSecret } from "../utils/file-secret";

export function getExternalOidcConfig() {
  const issuer = process.env.EXTERNAL_IDENTITY_ISSUER?.trim();
  const clientId = process.env.EXTERNAL_OIDC_CLIENT_ID?.trim();
  const clientSecret = resolveFileSecret("EXTERNAL_OIDC_CLIENT_SECRET");
  if (!clientId && !clientSecret) return null;
  if (!issuer || !clientId || !clientSecret) {
    throw new Error(
      "External OIDC requires issuer, client ID and client secret",
    );
  }
  const url = new URL(issuer);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "External OIDC issuer must be an HTTPS URL without credentials, query or fragment",
    );
  }
  const apiUrl = process.env.KANEO_API_URL || "http://localhost:1337";
  const clientUrl = process.env.KANEO_CLIENT_URL || "http://localhost:5173";
  // The bundled image sets KANEO_API_URL to "<client>/api"; the same value is
  // also used without that suffix for a separately hosted API.
  const apiOrigin = apiUrl.replace(/\/api\/?$/, "").replace(/\/+$/, "");
  const callback = `${apiOrigin}/api/auth/external-oidc/callback`;
  const client = new URL(clientUrl);
  if (
    !["http:", "https:"].includes(client.protocol) ||
    client.username ||
    client.password
  ) {
    throw new Error(
      "KANEO_CLIENT_URL must be an HTTP or HTTPS URL without credentials",
    );
  }
  return { issuer, clientId, clientSecret, callback, clientUrl: client.href };
}
