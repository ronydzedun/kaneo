import { sql } from "drizzle-orm";
import {
  externalIdentityTable,
  sessionTable,
  userTable,
} from "../database/schema";

/** Native users are unaffected; every linked projection must have a live grant. */
export function externalAccessCondition(sessionId?: string) {
  const sessionEpochCheck =
    sessionId !== undefined
      ? sql`OR ${externalIdentityTable.accessEpoch} IS DISTINCT FROM (
        SELECT ${sessionTable.externalAccessEpoch} FROM ${sessionTable}
        WHERE ${sessionTable.id} = ${sessionId}
          AND ${sessionTable.userId} = ${userTable.id}
      )`
      : sql``;
  return sql`NOT EXISTS (
    SELECT 1 FROM ${externalIdentityTable}
    WHERE ${externalIdentityTable.userId} = ${userTable.id}
      AND (
        ${externalIdentityTable.accessGranted} IS NOT TRUE
        OR ${externalIdentityTable.accessValidUntil} IS NULL
        OR ${externalIdentityTable.accessValidUntil} <= (now() AT TIME ZONE 'utc')
        ${sessionEpochCheck}
      )
  )`;
}
