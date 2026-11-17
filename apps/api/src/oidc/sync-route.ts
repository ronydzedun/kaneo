import { createHash, timingSafeEqual } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { provisionExternalIdentity } from "./provision-external-identity";
import { getSyncConfig } from "./sync-config";
import {
  ExternalAccessRevisionConflict,
  synchronizeExternalAccess,
} from "./synchronize-external-access";

function sameSecret(actual: string, expected: string) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

const syncRoute = createRoute({
  method: "post",
  path: "/",
  operationId: "syncExternalIdentity",
  tags: ["External identity"],
  summary: "Synchronize an external identity",
  description:
    "Machine-only idempotent synchronization. The issuer and machine secret are configured on the server; permission leases must be renewed with increasing revisions.",
  middleware: [
    async (c, next) => {
      const config = getSyncConfig();
      if (!config) throw new HTTPException(404, { message: "Not found" });
      const authorization = c.req.header("authorization") ?? "";
      const match = /^Bearer ([^\s]+)$/i.exec(authorization);
      if (!match || !sameSecret(match[1]!, config.secret)) {
        throw new HTTPException(401, { message: "Unauthorized" });
      }
      await next();
    },
    boundedRequestBody(4096),
  ] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            subject: z.string().min(1).max(255),
            name: z.string().trim().min(1).max(255),
            revision: z.number().int().min(1).max(2_147_483_647),
            granted: z.boolean(),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Projection synchronized",
      z.object({
        userId: z.string(),
        created: z.boolean(),
        status: z.enum(["applied", "replayed"]),
      }),
    ),
    401: errorResponse("Unauthorized"),
    404: errorResponse("Synchronization not configured"),
    409: errorResponse("Outdated synchronization revision"),
    413: errorResponse("Request body too large"),
  },
});

const syncApi = apiRouter();
syncApi.openapi(syncRoute, async (c) => {
  const config = getSyncConfig();
  if (!config) throw new HTTPException(404, { message: "Not found" });
  const input = c.req.valid("json");
  const identity = {
    issuer: config.issuer,
    subject: input.subject,
    name: input.name,
  };
  const projection = await provisionExternalIdentity(identity);
  const result = await synchronizeExternalAccess({
    ...identity,
    revision: input.revision,
    granted: input.granted,
  }).catch((error: unknown) => {
    if (error instanceof ExternalAccessRevisionConflict) {
      throw new HTTPException(409, {
        message: "Conflicting synchronization revision",
      });
    }
    throw error;
  });
  if (result.status === "stale") {
    throw new HTTPException(409, {
      message: "Outdated synchronization revision",
    });
  }
  return c.json(
    {
      userId: projection.userId,
      created: projection.created,
      status: result.status,
    },
    200,
  );
});

export default syncApi;
