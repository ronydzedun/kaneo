import { eq } from "drizzle-orm";
import type { User } from "better-auth/types";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import db, { schema } from "../../apps/api/src/database";
import { invitationLinkTable } from "../../apps/api/src/database/schema";
import { createApp } from "../../apps/api/src/index";
import {
  acceptInvitationLink,
  createInvitationLink,
  revokeInvitationLink,
} from "../../apps/api/src/invitation/link/invitation-link-service";
import { invitationLinkTokenHash } from "../../apps/api/src/invitation/link/token";
import { resetTestDatabase } from "./helpers/database";
import { mockAuthenticatedSession } from "./helpers/auth";
import { createWorkspaceMember } from "./helpers/fixtures";

vi.mock("../../apps/api/src/workspace-members/handle-member-added", () => ({
  handleMemberAdded: async () => {},
}));

describe("email-free invitation links on PostgreSQL", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function fixture() {
    const { user, workspace } = await createWorkspaceMember({ role: "owner" });
    const [recipient] = await db
      .insert(schema.userTable)
      .values({
        name: "No email",
        email: null,
        emailVerified: false,
      })
      .returning();
    const input = {
      workspaceId: workspace.id,
      actorId: user.id,
      role: "member",
      projectAccess: "all" as const,
      projectIds: [],
    };
    return { user, workspace, recipient: recipient!, input };
  }

  it("allows exactly one concurrent acceptance without requiring email", async () => {
    const { input, recipient } = await fixture();
    const { token } = await createInvitationLink(input);
    const results = await Promise.allSettled([
      acceptInvitationLink(token, recipient.id),
      acceptInvitationLink(token, recipient.id),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const members = await db
      .select()
      .from(schema.workspaceUserTable)
      .where(eq(schema.workspaceUserTable.userId, recipient.id));
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe("member");
    const [link] = await db.select().from(invitationLinkTable);
    expect(link?.id).toBe(invitationLinkTokenHash(token));
    expect(link?.usedAt).not.toBeNull();
  });

  it("rejects revoked, expired and unauthorized invitations", async () => {
    const { input, recipient, user } = await fixture();
    const revoked = await createInvitationLink(input);
    await revokeInvitationLink(input.workspaceId, revoked.token);
    await expect(
      acceptInvitationLink(revoked.token, recipient.id),
    ).rejects.toThrow();
    const expired = await createInvitationLink(input);
    await db
      .update(invitationLinkTable)
      .set({ expiresAt: new Date(0) })
      .where(
        eq(invitationLinkTable.id, invitationLinkTokenHash(expired.token)!),
      );
    await expect(
      acceptInvitationLink(expired.token, recipient.id),
    ).rejects.toThrow();
    const noLongerAuthorized = await createInvitationLink(input);
    await db
      .update(schema.workspaceUserTable)
      .set({ role: "viewer" })
      .where(eq(schema.workspaceUserTable.userId, user.id));
    await expect(
      acceptInvitationLink(noLongerAuthorized.token, recipient.id),
    ).rejects.toThrow();
    await expect(
      createInvitationLink({ ...input, role: "owner" }),
    ).rejects.toThrow();
  });
  it("enforces session and workspace permissions through the HTTP routes", async () => {
    const { input, recipient, user } = await fixture();
    const { app } = createApp();
    const path = `/api/workspace/${input.workspaceId}/invitation-links`;
    const request = (url: string, data: unknown) =>
      app.request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
    const payload = { role: "member", projectAccess: "all", projectIds: [] };
    expect((await request(path, payload)).status).toBe(401);
    const session = mockAuthenticatedSession(user as User);
    const created = await request(path, payload);
    expect(created.status).toBe(200);
    const { token } = (await created.json()) as { token: string };
    expect(created.headers.get("cache-control")).toContain("no-store");

    const now = new Date();
    session.mockResolvedValue({
      user: recipient as unknown as User,
      session: {
        id: "recipient-session",
        userId: recipient.id,
        token: "test-token",
        expiresAt: new Date(now.getTime() + 60_000),
        createdAt: now,
        updatedAt: now,
        ipAddress: null,
        userAgent: null,
      },
    });
    expect((await request(path, payload)).status).toBe(404);
    expect(
      (await request("/api/invitation/link/accept", { token })).status,
    ).toBe(200);
    expect(
      (await request("/api/invitation/link/accept", { token })).status,
    ).toBe(404);
  });
});
