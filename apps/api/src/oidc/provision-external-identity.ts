import { and, eq, sql } from "drizzle-orm";
import db, { schema } from "../database";

type ExternalIdentity = {
  issuer: string;
  subject: string;
  name: string;
};

/**
 * Create the local projection without creating credentials or granting access.
 * Callers must authenticate the provisioning request and pin the issuer.
 */
export async function provisionExternalIdentity(
  identity: ExternalIdentity,
  database: Pick<typeof db, "transaction"> = db,
) {
  const name = identity.name.trim();
  if (
    !identity.issuer ||
    !identity.subject ||
    identity.subject.length > 255 ||
    !name ||
    name.length > 255
  ) {
    throw new Error("Invalid external identity");
  }

  return database.transaction(async (tx) => {
    // Serialize first creation for this exact pair, including when no row exists.
    const lockKey = JSON.stringify([identity.issuer, identity.subject]);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );

    const [existing] = await tx
      .select({ userId: schema.externalIdentityTable.userId })
      .from(schema.externalIdentityTable)
      .where(
        and(
          eq(schema.externalIdentityTable.issuer, identity.issuer),
          eq(schema.externalIdentityTable.subject, identity.subject),
        ),
      )
      .limit(1);
    if (existing) return { userId: existing.userId, created: false };

    const [user] = await tx
      .insert(schema.userTable)
      .values({
        name,
        email: null,
        emailVerified: false,
        isAnonymous: false,
        role: "user",
      })
      .returning({ id: schema.userTable.id });
    if (!user) throw new Error("Could not create external user");

    await tx.insert(schema.externalIdentityTable).values({
      issuer: identity.issuer,
      subject: identity.subject,
      userId: user.id,
    });
    return { userId: user.id, created: true };
  });
}
