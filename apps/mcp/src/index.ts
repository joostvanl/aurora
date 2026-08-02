#!/usr/bin/env node
/**
 * Aurora CMS MCP server (stdio).
 *
 * Required env:
 *   CMS_API_URL              — e.g. http://localhost:4000
 *   CMS_MANAGEMENT_TOKEN     — website-scoped aur_… token
 * Optional:
 *   CMS_WEBSITE_ID           — pin; must match token website
 *   CMS_SITE_KEY             — must match token website for public tools
 *
 * Log only to stderr — stdout is the MCP JSON-RPC channel.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpContext } from "./client.js";
import { createAuroraMcpServer } from "./createServer.js";

async function main() {
  const ctx = await createMcpContext();
  const server = createAuroraMcpServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[aurora-mcp] Ready on stdio");
}

main().catch((err) => {
  console.error(
    "[aurora-mcp] Fatal:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
