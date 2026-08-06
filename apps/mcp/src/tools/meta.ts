import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  selectWebsiteOnContext,
  syncClientAuth,
  whoamiSnapshot,
  type McpContext,
} from "../client.js";
import { toolError, toolOk } from "../errors.js";

export function registerMetaTools(server: McpServer, ctx: McpContext) {
  server.tool(
    "whoami",
    "Return the authenticated Aurora user, active website, membership role, and public-read flag.",
    {},
    async () => {
      try {
        return toolOk(whoamiSnapshot(ctx));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "list_websites",
    "List websites you belong to (memberships). Use select_website to activate one. Requires a personal access token (aur_u_…).",
    {},
    async () => {
      try {
        if (ctx.authMode === "website_token") {
          return toolOk({
            authMode: ctx.authMode,
            websites: ctx.website
              ? [
                  {
                    id: ctx.website.id,
                    name: ctx.website.name,
                    siteKey: ctx.website.siteKey,
                    role: "admin" as const,
                  },
                ]
              : [],
            note: "Legacy website-token mode is pinned to one site. Use CMS_USER_TOKEN to switch.",
          });
        }
        ctx.client.setToken(ctx.userToken);
        const websites = await ctx.client.listWebsites();
        ctx.memberships = websites;
        syncClientAuth(ctx);
        return toolOk({
          websites,
          activeWebsiteId: ctx.website?.id ?? null,
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "select_website",
    "Activate a website for this MCP session (issues a JWT with your membership role). Requires CMS_USER_TOKEN (aur_u_…). Re-select if the session JWT expires.",
    {
      websiteId: z.string().min(1).describe("Website id from list_websites"),
    },
    async (input) => {
      try {
        await selectWebsiteOnContext(ctx, input.websiteId);
        return toolOk(whoamiSnapshot(ctx));
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
