import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { isAssignableWorkspaceRole } from "../../admin/is-assignable-workspace-role";
import { lockWorkspace } from "../../admin/lock-workspace";
import db from "../../database";
import {
  invitationLinkTable,
  userTable,
  workspaceTable,
  workspaceUserTable,
} from "../../database/schema";
import { externalAccessCondition } from "../../oidc/external-access-condition";
import { replaceMemberProjectAccess } from "../../project-access/replace-member-project-access";
import { resolveProjectAccessRequest } from "../../project-access/resolve-project-access-request";
import { roleHasWorkspacePermission } from "../../utils/require-workspace-permission";
import { notBannedCondition } from "../../utils/user-ban";
import { handleMemberAdded } from "../../workspace-members/handle-member-added";
import { createInvitationLinkToken, invitationLinkTokenHash } from "./token";

const LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const invalidLink = () =>
  new HTTPException(404, { message: "Invitation link is unavailable" });

type LinkInput = {
  workspaceId: string;
  actorId: string;
  role: string;
  projectAccess: "all" | "selected";
  projectIds: string[];
};

async function assertInviter(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: LinkInput,
  members: { userId: string; role: string }[],
) {
  const member = members.find((entry) => entry.userId === input.actorId);
  if (
    !member ||
    !(await roleHasWorkspacePermission(
      input.workspaceId,
      member.role,
      { invitation: ["create"] },
      tx,
    ))
  ) {
    throw new HTTPException(403, { message: "Invitation permission required" });
  }
  const [actor] = await tx
    .select({ id: userTable.id })
    .from(userTable)
    .where(
      and(
        eq(userTable.id, input.actorId),
        notBannedCondition(),
        externalAccessCondition(),
      ),
    )
    .limit(1);
  if (!actor)
    throw new HTTPException(403, { message: "Invitation permission required" });
  if (!(await isAssignableWorkspaceRole(tx, input.workspaceId, input.role))) {
    throw new HTTPException(400, { message: "Invalid invitation role" });
  }
  const resolution = await resolveProjectAccessRequest({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    targetRole: input.role,
    projectAccess: input.projectAccess,
    projectIds: input.projectIds,
    database: tx,
  });
  if (!resolution.ok)
    throw new HTTPException(resolution.status, { message: resolution.message });
  return resolution.access;
}

export async function createInvitationLink(input: LinkInput) {
  const token = createInvitationLinkToken();
  const id = invitationLinkTokenHash(token);
  if (!id) throw new Error("Invalid generated token");
  const expiresAt = new Date(Date.now() + LINK_LIFETIME_MS);
  await db.transaction(async (tx) => {
    const members = await lockWorkspace(tx, input.workspaceId);
    const [workspace] = await tx
      .select({ id: workspaceTable.id })
      .from(workspaceTable)
      .where(
        and(
          eq(workspaceTable.id, input.workspaceId),
          isNull(workspaceTable.archivedAt),
        ),
      );
    if (!workspace) throw invalidLink();
    const access = await assertInviter(tx, input, members);
    await tx.insert(invitationLinkTable).values({
      id,
      workspaceId: input.workspaceId,
      inviterId: input.actorId,
      role: input.role,
      projectAccess: access.projectAccess,
      projectIds: access.projectIds,
      expiresAt,
    });
  });
  return { token, expiresAt };
}

export async function acceptInvitationLink(token: string, userId: string) {
  const id = invitationLinkTokenHash(token);
  if (!id) throw invalidLink();
  const result = await db.transaction(async (tx) => {
    const [lookup] = await tx
      .select({ workspaceId: invitationLinkTable.workspaceId })
      .from(invitationLinkTable)
      .where(eq(invitationLinkTable.id, id))
      .limit(1);
    if (!lookup) throw invalidLink();
    const members = await lockWorkspace(tx, lookup.workspaceId);
    const [link] = await tx
      .select()
      .from(invitationLinkTable)
      .where(eq(invitationLinkTable.id, id))
      .limit(1)
      .for("update");
    const [workspace] = await tx
      .select({ id: workspaceTable.id })
      .from(workspaceTable)
      .where(
        and(
          eq(workspaceTable.id, lookup.workspaceId),
          isNull(workspaceTable.archivedAt),
        ),
      );
    if (
      !link ||
      !workspace ||
      link.usedAt ||
      link.revokedAt ||
      link.expiresAt <= new Date()
    ) {
      throw invalidLink();
    }
    if (members.some((member) => member.userId === userId)) {
      throw new HTTPException(409, { message: "Already a workspace member" });
    }
    if (link.projectAccess !== "all" && link.projectAccess !== "selected")
      throw invalidLink();
    const access = await assertInviter(
      tx,
      {
        workspaceId: link.workspaceId,
        actorId: link.inviterId,
        role: link.role,
        projectAccess: link.projectAccess,
        projectIds: link.projectIds,
      },
      members,
    );
    await tx.insert(workspaceUserTable).values({
      workspaceId: link.workspaceId,
      userId,
      role: link.role,
      joinedAt: new Date(),
    });
    await replaceMemberProjectAccess(tx, {
      workspaceId: link.workspaceId,
      userId,
      ...access,
    });
    await tx
      .update(invitationLinkTable)
      .set({ usedAt: new Date() })
      .where(eq(invitationLinkTable.id, id));
    return { workspaceId: link.workspaceId };
  });
  await handleMemberAdded(result.workspaceId, userId);
  return result;
}

export async function revokeInvitationLink(workspaceId: string, token: string) {
  const id = invitationLinkTokenHash(token);
  if (!id) throw invalidLink();
  const [row] = await db
    .update(invitationLinkTable)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(invitationLinkTable.id, id),
        eq(invitationLinkTable.workspaceId, workspaceId),
        isNull(invitationLinkTable.usedAt),
        isNull(invitationLinkTable.revokedAt),
      ),
    )
    .returning({ id: invitationLinkTable.id });
  if (!row) throw invalidLink();
}
