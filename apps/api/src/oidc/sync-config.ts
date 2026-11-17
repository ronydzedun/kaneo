import { resolveFileSecret } from "../utils/file-secret";

export function getSyncConfig() {
  const issuer = process.env.EXTERNAL_IDENTITY_ISSUER?.trim();
  const secret = resolveFileSecret("EXTERNAL_IDENTITY_SYNC_SECRET");
  if (!secret) return null;
  if (!issuer || !secret || !/^[A-Za-z0-9._~-]{32,512}$/.test(secret)) {
    throw new Error(
      "External identity synchronization requires an issuer and a secret of at least 32 bytes",
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
      "External identity issuer must be an HTTPS URL without credentials, query or fragment",
    );
  }
  return { issuer, secret };
}
