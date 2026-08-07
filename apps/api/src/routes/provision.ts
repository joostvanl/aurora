import type { FastifyInstance } from "fastify";
import {
  requireWebsite,
  websiteIdFrom,
  userIdFrom,
} from "../auth/middleware.js";
import { RolePermission } from "../auth/roles.js";
import { asCreatedByUserId } from "../lib/entries.js";
import {
  applyContentTypes,
  ProvisionSchema,
} from "../lib/provisionApply.js";

/**
 * Idempotent provisioning for site-building agents:
 * ensure types + fields + entries in one call.
 */
export async function registerProvisionRoutes(app: FastifyInstance) {
  app.register(async (scoped) => {
    scoped.addHook("preHandler", requireWebsite(RolePermission.schema));

    scoped.post("/api/v1/admin/provision", async (request) => {
      const websiteId = websiteIdFrom(request);
      const body = ProvisionSchema.parse(request.body);
      const { results } = await applyContentTypes(websiteId, body.contentTypes, {
        mode: "overwrite",
        createdByUserId: asCreatedByUserId(userIdFrom(request)),
      });
      return { ok: true as const, results };
    });
  });
}
