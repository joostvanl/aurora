import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpContext } from "../client.js";
import { toolError, toolOk } from "../errors.js";

function requirePublic(ctx: McpContext) {
  if (!ctx.publicEnabled) {
    throw new Error(
      "Public tools need a site key. Set CMS_SITE_KEY, or select_website so MCP can use the website siteKey.",
    );
  }
}

export function registerPublicTools(server: McpServer, ctx: McpContext) {
  const { client } = ctx;

  server.tool(
    "cors_check",
    "Diagnose whether an Origin would be allowed by the API CORS rules.",
    { origin: z.string().optional() },
    async ({ origin }) => {
      try {
        return toolOk(await client.corsCheck(origin));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "get_openapi",
    "Fetch public OpenAPI document (requires matching CMS_SITE_KEY).",
    {},
    async () => {
      try {
        requirePublic(ctx);
        return toolOk(await client.getOpenApi());
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "get_bootstrap",
    "Site chrome + home in one call (siteSettings, nav, primaryPage). Requires CMS_SITE_KEY.",
    {},
    async () => {
      try {
        requirePublic(ctx);
        return toolOk(await client.getBootstrap());
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "list_content_types_public",
    "List published content-type schemas via public API (requires CMS_SITE_KEY).",
    {},
    async () => {
      try {
        requirePublic(ctx);
        // Force public path: temporarily clear preference for admin in getContentType
        // listContentTypes always uses site key.
        return toolOk(await client.listContentTypes());
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "get_content_type_schema",
    "JSON Schema for entry.fields of a content type (public). Requires CMS_SITE_KEY.",
    { apiId: z.string().min(1) },
    async ({ apiId }) => {
      try {
        requirePublic(ctx);
        return toolOk(await client.getContentTypeSchema(apiId));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "list_published_entries",
    "List published entries (public API). Requires CMS_SITE_KEY.",
    {
      apiId: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
      slug: z.string().optional(),
      sort: z
        .enum(["publishedAt", "createdAt", "updatedAt", "sortOrder"])
        .optional(),
      order: z.enum(["asc", "desc"]).optional(),
    },
    async ({ apiId, ...params }) => {
      try {
        requirePublic(ctx);
        return toolOk(await client.listPublishedEntries(apiId, params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "get_published_entry",
    "Get one published entry by slug (public API). Optional previewToken for drafts.",
    {
      apiId: z.string().min(1),
      slug: z.string().min(1),
      previewToken: z.string().optional(),
    },
    async ({ apiId, slug, previewToken }) => {
      try {
        requirePublic(ctx);
        return toolOk(
          await client.getPublishedEntry(apiId, slug, previewToken),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
