import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "./client.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { registerEntryTools } from "./tools/entries.js";
import { registerFormTools } from "./tools/forms.js";
import { registerMetaTools } from "./tools/meta.js";
import { registerPackageTools } from "./tools/packages.js";
import { registerPublicTools } from "./tools/public.js";
import { registerSchemaTools } from "./tools/schema.js";
import { registerWebsiteTools } from "./tools/website.js";

export function createAuroraMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer({
    name: "aurora-cms",
    version: "1.0.0",
  });

  registerMetaTools(server, ctx);
  registerSchemaTools(server, ctx);
  registerEntryTools(server, ctx);
  registerFormTools(server, ctx);
  registerWebsiteTools(server, ctx);
  registerPackageTools(server, ctx);
  registerPublicTools(server, ctx);
  registerResources(server, ctx);
  registerPrompts(server, ctx);

  return server;
}
