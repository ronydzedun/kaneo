import { and, eq } from "drizzle-orm";
import db from "../database";
import { userTable } from "../database/schema";
import { externalAccessCondition } from "./external-access-condition";

export async function hasExternalAccess(userId: string, sessionId: string) {
  const [user] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(and(eq(userTable.id, userId), externalAccessCondition(sessionId)))
    .limit(1);
  return Boolean(user);
}
