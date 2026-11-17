import { client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

export async function createInvitationLink(input: {
  workspaceId: string;
  role: string;
  projectAccess: "all" | "selected";
  projectIds: string[];
}) {
  const { workspaceId, ...json } = input;
  const response = await client.workspace[":workspaceId"][
    "invitation-links"
  ].$post({
    param: { workspaceId },
    json,
  });
  if (!response.ok) throw await HttpError.fromResponse(response);
  return response.json();
}

export async function acceptInvitationLink(token: string) {
  const response = await client.invitation.link.accept.$post({
    json: { token },
  });
  if (!response.ok) throw await HttpError.fromResponse(response);
  return response.json();
}

export async function revokeInvitationLink(workspaceId: string, token: string) {
  const response = await client.workspace[":workspaceId"][
    "invitation-links"
  ].revoke.$post({
    param: { workspaceId },
    json: { token },
  });
  if (!response.ok) throw await HttpError.fromResponse(response);
  return response.json();
}
