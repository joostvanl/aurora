import type { FastifyInstance } from "fastify";
import { requireWebsite, websiteIdFrom } from "../auth/middleware.js";
import { RolePermission } from "../auth/roles.js";
import { sumContentRequestsForWebsite } from "./usage.js";

export async function registerAnalyticsRoutes(app: FastifyInstance) {
  app.register(async (analytics) => {
    analytics.addHook("preHandler", requireWebsite(RolePermission.content));

    analytics.get("/api/v1/admin/analytics/content-requests", async (request) => {
      const usage = await sumContentRequestsForWebsite(websiteIdFrom(request));
      return {
        periodFrom: usage.from,
        periodTo: usage.to,
        requestCount: usage.requestCount,
        listCount: usage.listCount,
        getCount: usage.getCount,
        pageViews: usage.pageViews,
      };
    });
  });
}
