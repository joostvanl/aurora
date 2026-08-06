import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpContext } from "../client.js";
import { toolError, toolOk } from "../errors.js";

export function registerWebsiteTools(server: McpServer, ctx: McpContext) {
  const { client } = ctx;

  server.tool(
    "get_website",
    "Get website details for the token tenant (includes siteKey for frontend env — not a write credential).",
    {},
    async () => {
      try {
        const website = await client.getWebsite();
        ctx.website = website;
        return toolOk(website);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "update_website",
    "Update website name, description, allowedOrigins, or locales.",
    {
      name: z.string().min(1).max(120).optional(),
      description: z.union([z.string().max(2000), z.literal("")]).optional(),
      allowedOrigins: z.array(z.string().max(500)).max(50).optional(),
      locales: z
        .array(z.string().regex(/^[a-z]{2}-[A-Z]{2}$/))
        .optional(),
      defaultLocale: z
        .string()
        .regex(/^[a-z]{2}-[A-Z]{2}$/)
        .optional(),
    },
    async (input) => {
      try {
        const result = await client.updateWebsite(input);
        ctx.website = result.website;
        return toolOk(result.website);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "upload_media",
    "Upload an image file from a local path (jpeg/png/webp/gif, max 25MB). With ImageKit, oversized images are auto-downscaled on upload. Returns { url, … }.",
    {
      filePath: z.string().min(1),
      filename: z.string().optional(),
    },
    async ({ filePath, filename }) => {
      try {
        const { readFile } = await import("node:fs/promises");
        const path = await import("node:path");
        const buf = await readFile(filePath);
        const name = filename ?? path.basename(filePath);
        const blob = new Blob([buf]);
        return toolOk(await client.uploadMedia(blob, name));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
