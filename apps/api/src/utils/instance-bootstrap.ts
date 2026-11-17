import { and, asc, count, eq, or, sql } from "drizzle-orm";
import db, { schema } from "../database";
import { instanceAdminRoleSql } from "./instance-admin-role";

export const nonAnonymousUser = sql`${schema.userTable.isAnonymous} IS NOT TRUE`;

const locallyRegisteredUser = and(
  nonAnonymousUser,
  sql`NOT EXISTS (SELECT 1 FROM ${schema.externalIdentityTable} WHERE ${schema.externalIdentityTable.userId} = ${schema.userTable.id})`,
);

export async function hasRegisteredUsers(
  database: Pick<typeof db, "select"> = db,
): Promise<boolean> {
  const [row] = await database
    .select({ value: count() })
    .from(schema.userTable)
    .where(
      or(
        locallyRegisteredUser,
        and(nonAnonymousUser, instanceAdminRoleSql(schema.userTable.role)),
      ),
    );
  return (row?.value ?? 0) > 0;
}

export async function promoteInitialAdministrator(
  userId: string,
  database: Pick<typeof db, "transaction"> = db,
): Promise<void> {
  await database.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(2026)`);
    const [admin] = await tx
      .select({ id: schema.userTable.id })
      .from(schema.userTable)
      .where(and(nonAnonymousUser, instanceAdminRoleSql(schema.userTable.role)))
      .limit(1);
    if (admin) return;

    // Elect the earliest registered user, not the only row: concurrent first
    // signups may both be inserted before either after-hook gets this lock.
    // Existing non-admin accounts remain ineligible for promotion by a later
    // signup. Anonymous rows never consume the initial-admin slot.
    const [first] = await tx
      .select({ id: schema.userTable.id })
      .from(schema.userTable)
      .where(locallyRegisteredUser)
      .orderBy(asc(schema.userTable.createdAt), asc(schema.userTable.id))
      .limit(1);
    if (first?.id !== userId) return;
    await tx
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, userId));
  });
}
