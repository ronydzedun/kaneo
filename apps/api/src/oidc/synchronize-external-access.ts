import { and, eq, sql } from "drizzle-orm";
import db, { schema } from "../database";
import { revokeUserConnections } from "../ws";

const LEASE_SECONDS = 60;

export class ExternalAccessRevisionConflict extends Error {}

type AccessUpdate = {
  issuer: string;
  subject: string;
  revision: number;
  granted: boolean;
};

/**
 * Apply a monotonically versioned control-plane update. Replays never renew a
 * lease: the control plane must send a newer revision while access remains valid.
 */
export async function synchronizeExternalAccess(
  update: AccessUpdate,
  database: Pick<typeof db, "transaction"> = db,
  closeConnections: (userId: string) => Promise<void> = revokeUserConnections,
) {
  if (
    !Number.isInteger(update.revision) ||
    update.revision < 1 ||
    update.revision > 2_147_483_647
  ) {
    throw new Error("Invalid external access revision");
  }

  const result = await database.transaction(async (tx) => {
    const [identity] = await tx
      .select()
      .from(schema.externalIdentityTable)
      .where(
        and(
          eq(schema.externalIdentityTable.issuer, update.issuer),
          eq(schema.externalIdentityTable.subject, update.subject),
        ),
      )
      .limit(1)
      .for("update");
    if (!identity) throw new Error("External identity not found");
    if (update.revision < identity.revision) {
      return {
        status: "stale" as const,
        userId: identity.userId,
        close: false,
      };
    }
    if (update.revision === identity.revision) {
      if (update.granted !== identity.accessGranted) {
        throw new ExternalAccessRevisionConflict(
          "External access revision conflict",
        );
      }
      if (!identity.accessGranted) {
        await tx
          .delete(schema.sessionTable)
          .where(eq(schema.sessionTable.userId, identity.userId));
      }
      return {
        status: "replayed" as const,
        userId: identity.userId,
        close: !identity.accessGranted,
      };
    }

    await tx
      .update(schema.externalIdentityTable)
      .set({
        revision: update.revision,
        accessGranted: update.granted,
        ...(!update.granted
          ? {
              accessEpoch: sql`${schema.externalIdentityTable.accessEpoch} + 1`,
            }
          : {}),
        accessValidUntil: update.granted
          ? sql`(now() AT TIME ZONE 'utc') + (${LEASE_SECONDS} * interval '1 second')`
          : null,
      })
      .where(eq(schema.externalIdentityTable.id, identity.id));

    if (!update.granted) {
      await tx
        .delete(schema.sessionTable)
        .where(eq(schema.sessionTable.userId, identity.userId));
    }
    return {
      status: "applied" as const,
      userId: identity.userId,
      close: !update.granted,
    };
  });
  if (result.close) await closeConnections(result.userId);
  return { status: result.status, userId: result.userId };
}
