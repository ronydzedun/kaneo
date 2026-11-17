import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { endProviderSessions } from "../backchannel-logout/controllers/end-provider-sessions";
import * as schema from "../database/schema";
import {
  hasRegisteredUsers,
  promoteInitialAdministrator,
} from "../utils/instance-bootstrap";
import { findDeniedExternalUsers } from "../ws/find-denied-external-users";
import { provisionExternalIdentity } from "./provision-external-identity";
import { externalAccessCondition } from "./external-access-condition";
import { synchronizeExternalAccess } from "./synchronize-external-access";
import { prepareExternalSession } from "./prepare-external-session";

describe("external identity projection with PostgreSQL-compatible SQL", () => {
  const client = new PGlite();
  const database = drizzle(client, {
    schema,
  }) as unknown as typeof import("../database").default;

  beforeAll(async () => {
    await client.exec(`
      CREATE TABLE "user" (
        id text PRIMARY KEY, name text NOT NULL, email text UNIQUE,
        email_verified boolean NOT NULL, image text, locale text,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL,
        is_anonymous boolean DEFAULT false, role text, banned boolean DEFAULT false,
        ban_reason text, ban_expires timestamp,
        email_verification_required boolean DEFAULT false NOT NULL
      )
    `);
    await client.exec(
      'CREATE TABLE "session" (id text PRIMARY KEY, user_id text NOT NULL, oidc_sid text)',
    );
    await client.exec(`CREATE TABLE "verification" (
      id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
      expires_at timestamp NOT NULL, created_at timestamp DEFAULT now() NOT NULL,
      updated_at timestamp DEFAULT now() NOT NULL
    )`);
    await client.exec(
      await readFile(
        new URL("../../drizzle/0075_thankful_marvel_boy.sql", import.meta.url),
        "utf8",
      ),
    );
    await client.exec(
      await readFile(
        new URL("../../drizzle/0076_dashing_zaran.sql", import.meta.url),
        "utf8",
      ),
    );
    await client.exec(
      await readFile(
        new URL("../../drizzle/0077_fluffy_cable.sql", import.meta.url),
        "utf8",
      ),
    );
  });

  afterAll(async () => {
    await client.close();
  });

  it("creates denied users idempotently without consuming initial admin setup", async () => {
    const identity = {
      issuer: "https://id.example",
      subject: "subject",
      name: "Alice",
    };
    const first = await provisionExternalIdentity(identity, database);
    const repeat = await provisionExternalIdentity(identity, database);
    const other = await provisionExternalIdentity(
      { ...identity, issuer: "https://other.example" },
      database,
    );
    expect(first.created).toBe(true);
    expect(repeat).toEqual({ userId: first.userId, created: false });
    expect(other.userId).not.toBe(first.userId);
    expect(await hasRegisteredUsers(database)).toBe(false);

    await promoteInitialAdministrator(first.userId, database);
    const users = await client.query<{ email: string | null; role: string }>(
      `SELECT email, role FROM "user"`,
    );
    expect(users.rows).toEqual([
      { email: null, role: "user" },
      { email: null, role: "user" },
    ]);
    const projections = await client.query<{ access_granted: boolean }>(
      "SELECT access_granted FROM external_identity",
    );
    expect(projections.rows.every((row) => !row.access_granted)).toBe(true);
    const permitted = (userId: string) =>
      database
        .select({ id: schema.userTable.id })
        .from(schema.userTable)
        .where(and(eq(schema.userTable.id, userId), externalAccessCondition()));
    expect(await permitted(first.userId)).toHaveLength(0);
    await expect(
      prepareExternalSession(first.userId, database),
    ).rejects.toThrow();
    await client.query(
      `UPDATE external_identity
       SET access_granted = true, access_valid_until = (now() AT TIME ZONE 'utc') + interval '5 minutes'
       WHERE user_id = $1`,
      [first.userId],
    );
    expect(await permitted(first.userId)).toHaveLength(1);
    expect(await permitted(other.userId)).toHaveLength(0);
    expect(await prepareExternalSession(first.userId, database)).toBe(0);
    await client.query('INSERT INTO "session" (id, user_id) VALUES ($1, $2)', [
      "session",
      first.userId,
    ]);
    const close = vi.fn().mockResolvedValue(undefined);
    const revoked = { ...identity, revision: 1, granted: false };
    expect(await synchronizeExternalAccess(revoked, database, close)).toEqual({
      status: "applied",
      userId: first.userId,
    });
    expect(await permitted(first.userId)).toHaveLength(0);
    expect((await client.query('SELECT id FROM "session"')).rows).toHaveLength(
      0,
    );
    expect(close).toHaveBeenCalledWith(first.userId);
    expect(
      (await synchronizeExternalAccess(revoked, database, close)).status,
    ).toBe("replayed");
    expect(
      (
        await synchronizeExternalAccess(
          { ...revoked, revision: 2, granted: true },
          database,
          close,
        )
      ).status,
    ).toBe("applied");
    expect(await permitted(first.userId)).toHaveLength(1);
    expect(await prepareExternalSession(first.userId, database)).toBe(1);
    await client.query(
      `INSERT INTO "session" (id, user_id, external_access_epoch) VALUES
       ('stale', $1, 0), ('current', $1, 1)`,
      [first.userId],
    );
    const sessionPermitted = (sessionId: string) =>
      database
        .select({ id: schema.userTable.id })
        .from(schema.userTable)
        .where(
          and(
            eq(schema.userTable.id, first.userId),
            externalAccessCondition(sessionId),
          ),
        );
    expect(await sessionPermitted("stale")).toHaveLength(0);
    expect(await sessionPermitted("current")).toHaveLength(1);
    expect(
      (await synchronizeExternalAccess(revoked, database, close)).status,
    ).toBe("stale");
    expect(await permitted(first.userId)).toHaveLength(1);
    await client.query(
      `UPDATE external_identity SET access_valid_until = (now() AT TIME ZONE 'utc') - interval '1 second' WHERE user_id = $1`,
      [first.userId],
    );
    expect(
      (
        await synchronizeExternalAccess(
          { ...revoked, revision: 2, granted: true },
          database,
          close,
        )
      ).status,
    ).toBe("replayed");
    expect(await permitted(first.userId)).toHaveLength(0);

    await client.exec(`
      INSERT INTO "user" (id, name, email, email_verified, role)
      VALUES ('local', 'Local', 'local@example.com', false, 'user')
    `);
    expect(await hasRegisteredUsers(database)).toBe(true);
    expect(await permitted("local")).toHaveLength(1);
    expect(
      await findDeniedExternalUsers(
        [first.userId, other.userId, "local"],
        database,
      ),
    ).toEqual(new Set([first.userId, other.userId]));
    await promoteInitialAdministrator("local", database);
    const [local] = (
      await client.query<{ role: string }>(
        `SELECT role FROM "user" WHERE id = 'local'`,
      )
    ).rows;
    expect(local?.role).toBe("admin");
    await client.query(
      `INSERT INTO "session" (id,user_id,oidc_sid,oidc_issuer) VALUES
       ('provider-session',$1,'sid','https://id.example'),
       ('other-session',$1,'sid','https://other.example'),
       ('native-session',$1,NULL,NULL)`,
      [first.userId],
    );
    const closeLogout = vi.fn().mockResolvedValue(undefined);
    const logout = {
      iss: identity.issuer,
      sub: identity.subject,
      sid: "sid",
      jti: "one-time-logout",
      iat: Math.floor(Date.now() / 1000),
    };
    await endProviderSessions(
      logout,
      { externalOnly: true },
      database,
      closeLogout,
    );
    const remaining = await client.query<{ id: string }>(
      `SELECT id FROM "session" WHERE id IN ('provider-session','other-session','native-session')`,
    );
    expect(new Set(remaining.rows.map((row) => row.id))).toEqual(
      new Set(["other-session", "native-session"]),
    );
    expect(closeLogout).toHaveBeenCalledWith(
      new Map([[first.userId, ["provider-session"]]]),
    );
    await expect(
      endProviderSessions(
        logout,
        { externalOnly: true },
        database,
        closeLogout,
      ),
    ).rejects.toThrow();
  });
});
