import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import db, { schema } from "../../apps/api/src/database";
import { provisionExternalIdentity } from "../../apps/api/src/oidc/provision-external-identity";
import { synchronizeExternalAccess } from "../../apps/api/src/oidc/synchronize-external-access";
import { resetTestDatabase } from "./helpers/database";

describe("external identity concurrency on PostgreSQL", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("creates one denied projection under concurrent provisioning", async () => {
    const identity = {
      issuer: "https://id.example",
      subject: "subject",
      name: "Alice",
    };
    const results = await Promise.all(
      Array.from({ length: 12 }, () => provisionExternalIdentity(identity)),
    );
    expect(new Set(results.map((result) => result.userId)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    const users = await db.select().from(schema.userTable);
    const identities = await db.select().from(schema.externalIdentityTable);
    expect(users).toHaveLength(1);
    expect(users[0]?.email).toBeNull();
    expect(identities).toHaveLength(1);
    expect(identities[0]?.accessGranted).toBe(false);
  });

  it("never lets an older grant override a concurrently applied revoke", async () => {
    const identity = {
      issuer: "https://id.example",
      subject: "subject",
      name: "Alice",
    };
    const { userId } = await provisionExternalIdentity(identity);
    const close = async () => {};
    await Promise.all([
      synchronizeExternalAccess(
        { ...identity, revision: 1, granted: true },
        db,
        close,
      ),
      synchronizeExternalAccess(
        { ...identity, revision: 2, granted: false },
        db,
        close,
      ),
    ]);
    const [projection] = await db
      .select()
      .from(schema.externalIdentityTable)
      .where(eq(schema.externalIdentityTable.userId, userId));
    expect(projection?.revision).toBe(2);
    expect(projection?.accessGranted).toBe(false);
    expect(projection?.accessValidUntil).toBeNull();
  });
});
