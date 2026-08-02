import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../client.js";
import { toolError, toolOk } from "../errors.js";

export function registerMetaTools(server: McpServer, ctx: McpContext) {
  server.tool(
    "whoami",
    "Return the active Aurora website bound to CMS_MANAGEMENT_TOKEN (tenant sanity check).",
    {},
    async () => {
      try {
        const w = ctx.website;
        return toolOk({
          websiteId: w.id,
          websiteName: w.name,
          description: w.description,
          siteKey: w.siteKey,
          publicReadEnabled: ctx.publicEnabled,
          apiUrl: ctx.apiUrl,
          locales: w.locales,
          defaultLocale: w.defaultLocale,
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "health",
    "Ping the Aurora API /health endpoint (no auth).",
    {},
    async () => {
      try {
        return toolOk(await ctx.client.health());
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
