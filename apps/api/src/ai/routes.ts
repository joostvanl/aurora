import type { FastifyInstance } from "fastify";
import {
  AiChatRequestSchema,
  AiConfigUpdateSchema,
  AiListModelsRequestSchema,
} from "@cms/shared";
import { requireWebsite, websiteIdFrom } from "../auth/middleware.js";
import { RolePermission } from "../auth/roles.js";
import { runAiChat } from "../ai/agent.js";
import { resolveAiConfig, toPublicAiStatus, updateAiConfig } from "../ai/config.js";
import { listProviderModels } from "../ai/openai.js";

export async function registerAiRoutes(app: FastifyInstance) {
  app.register(async (ai) => {
    ai.addHook("preHandler", requireWebsite(RolePermission.content));

    ai.get("/api/v1/admin/ai/status", async (request) => {
      return toPublicAiStatus(websiteIdFrom(request));
    });

    ai.put(
      "/api/v1/admin/ai/config",
      { preHandler: requireWebsite(RolePermission.admin) },
      async (request) => {
        const body = AiConfigUpdateSchema.parse(request.body);
        await updateAiConfig(websiteIdFrom(request), body);
        return toPublicAiStatus(websiteIdFrom(request));
      },
    );

    ai.post(
      "/api/v1/admin/ai/models",
      { preHandler: requireWebsite(RolePermission.admin) },
      async (request) => {
        const body = AiListModelsRequestSchema.parse(request.body ?? {});
        const config = await resolveAiConfig(websiteIdFrom(request));
        const baseUrl = body.baseUrl?.trim() || config.baseUrl;
        const apiKey = body.apiKey?.trim() || config.apiKey;
        if (!baseUrl || !apiKey) {
          throw Object.assign(
            new Error(
              "Set Base URL and API key first, then refresh the model list",
            ),
            { statusCode: 400 },
          );
        }
        const models = await listProviderModels({ baseUrl, apiKey });
        return { models };
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
