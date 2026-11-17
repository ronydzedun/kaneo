import { and, inArray, sql } from "drizzle-orm";
import db from "../database";
import { externalIdentityTable } from "../database/schema";

const BATCH_SIZE = 500;

export async function findDeniedExternalUsers(
  userIds: readonly string[],
  database: Pick<typeof db, "select"> = db,
): Promise<Set<string>> {
  const denied = new Set<string>();
  for (let offset = 0; offset < userIds.length; offset += BATCH_SIZE) {
    const rows = await database
      .select({ userId: externalIdentityTable.userId })
      .from(externalIdentityTable)
      .where(
        and(
          inArray(
            externalIdentityTable.userId,
            userIds.slice(offset, offset + BATCH_SIZE),
          ),
          sql`(${externalIdentityTable.accessGranted} IS NOT TRUE
            OR ${externalIdentityTable.accessValidUntil} IS NULL
            OR ${externalIdentityTable.accessValidUntil} <= (now() AT TIME ZONE 'utc'))`,
        ),
      );
    for (const row of rows) denied.add(row.userId);
  }
  return denied;
}
