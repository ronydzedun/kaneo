import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../../openapi";
import { requireUserSession } from "../../utils/require-user-session";
import { requireWorkspacePermission } from "../../utils/require-workspace-permission";
import { workspaceAccess } from "../../utils/workspace-access-middleware";
import {
  acceptInvitationLink,
  createInvitationLink,
  revokeInvitationLink,
} from "./invitation-link-service";

const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const workspaceParam = z.object({ workspaceId: z.string().min(1) });
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});
const responses = {
  400: errorResponse("Invalid invitation"),
  403: errorResponse("Missing permission"),
  404: errorResponse("Invitation or workspace unavailable"),
  409: errorResponse("Already a workspace member"),
};

const create = createRoute({
  method: "post",
  path: "/{workspaceId}/invitation-links",
  operationId: "createInvitationLink",
  tags: ["Invitations"],
  summary: "Create a single-use invitation link without email",
  middleware: [
    requireUserSession,
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ invitation: ["create"] }),
  ] as const,
  request: {
    params: workspaceParam,
    body: body(
      z.object({
        role: z.string().min(1).max(255),
        projectAccess: z.enum(["all", "selected"]),
        projectIds: z.array(z.string().min(1)).max(500),
      }),
    ),
  },
  responses: {
    200: jsonResponse(
      "Invitation token, shown only once",
      z.object({
        token,
        expiresAt: z.string(),
      }),
    ),
    ...responses,
  },
});

const revoke = createRoute({
  method: "post",
  path: "/{workspaceId}/invitation-links/revoke",
  operationId: "revokeInvitationLink",
  tags: ["Invitations"],
  summary: "Revoke an unused invitation link",
  middleware: [
    requireUserSession,
    workspaceAccess.fromParam("workspaceId"),
    requireWorkspacePermission({ invitation: ["cancel"] }),
  ] as const,
  request: { params: workspaceParam, body: body(z.object({ token })) },
  responses: {
    200: jsonResponse("Revoked", z.object({ revoked: z.literal(true) })),
    ...responses,
  },
});

const accept = createRoute({
  method: "post",
  path: "/link/accept",
  operationId: "acceptInvitationLink",
  tags: ["Invitations"],
  summary: "Accept a single-use invitation link",
  middleware: [requireUserSession] as const,
  request: { body: body(z.object({ token })) },
  responses: {
    200: jsonResponse(
      "Joined workspace",
      z.object({ workspaceId: z.string() }),
    ),
    ...responses,
  },
});

export const workspaceInvitationLinks = apiRouter<
  BaseVariables & { workspaceId: string }
>()
  .openapi(create, async (c) => {
    const result = await createInvitationLink({
      workspaceId: c.get("workspaceId"),
      actorId: c.get("userId"),
      ...c.req.valid("json"),
    });
    return c.json(
      { token: result.token, expiresAt: result.expiresAt.toISOString() },
      200,
    );
  })
  .openapi(revoke, async (c) => {
    await revokeInvitationLink(c.get("workspaceId"), c.req.valid("json").token);
    return c.json({ revoked: true as const }, 200);
  });

export const invitationLinkAcceptance = apiRouter().openapi(accept, async (c) =>
  c.json(
    await acceptInvitationLink(c.req.valid("json").token, c.get("userId")),
    200,
  ),
);
