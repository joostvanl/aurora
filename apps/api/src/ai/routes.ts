import type { FastifyInstance } from "fastify";
import { AiChatRequestSchema, AiConfigUpdateSchema } from "@cms/shared";
import { requireWebsite, websiteIdFrom } from "../auth/middleware.js";
import { RolePermission } from "../auth/roles.js";
import { runAiChat } from "../ai/agent.js";
import {
  resolveAiConfig,
  toPublicAiStatus,
  updateAiConfig,
} from "../ai/config.js";

export async function registerAiRoutes(app: FastifyInstance) {
  app.register(async (ai) => {
    ai.addHook("preHandler", requireWebsite(RolePermission.content));

    ai.get("/api/v1/admin/ai/status", async (request) => {
      const config = await resolveAiConfig(websiteIdFrom(request));
      return toPublicAiStatus(config);
    });

    ai.put(
      "/api/v1/admin/ai/config",
      { preHandler: requireWebsite(RolePermission.admin) },
      async (request) => {
        const body = AiConfigUpdateSchema.parse(request.body);
        const config = await updateAiConfig(websiteIdFrom(request), body);
        return toPublicAiStatus(config);
      },
    );

    ai.post("/api/v1/admin/ai/chat", async (request) => {
      const body = AiChatRequestSchema.parse(request.body);
      return runAiChat({
        message: body.message,
        history: body.history,
        context: body.context,
        websiteId: websiteIdFrom(request),
        userId: request.user!.id,
        role: request.user!.role!,
      });
    });
  });
}
