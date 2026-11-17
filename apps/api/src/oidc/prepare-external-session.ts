import { APIError } from "better-auth/api";
import { eq, sql } from "drizzle-orm";
import db from "../database";
import { externalIdentityTable } from "../database/schema";

/**
 * Capture the revocation epoch before Better Auth inserts a session. A revoke
 * racing that insert increments the epoch, so the resulting session fails
 * closed even if the grant is later restored.
 */
export async function prepareExternalSession(
  userId: string,
  database: Pick<typeof db, "select"> = db,
): Promise<number | null> {
  const identities = await database
    .select({
      epoch: externalIdentityTable.accessEpoch,
      valid: sql<boolean>`${externalIdentityTable.accessGranted} IS TRUE
        AND ${externalIdentityTable.accessValidUntil} > (now() AT TIME ZONE 'utc')`,
    })
    .from(externalIdentityTable)
    .where(eq(externalIdentityTable.userId, userId))
    .limit(2);
  if (!identities.length) return null;
  if (identities.length !== 1 || !identities[0]?.valid) {
    throw new APIError("FORBIDDEN", {
      code: "EXTERNAL_ACCESS_DENIED",
      message: "Access denied",
    });
  }
  return identities[0].epoch;
}
