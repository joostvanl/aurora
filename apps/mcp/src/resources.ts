import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireActiveWebsite, type McpContext } from "./client.js";

function textResource(uri: string, text: string, mimeType = "application/json") {
  return {
    contents: [{ uri, mimeType, text }],
  };
}

export function registerResources(server: McpServer, ctx: McpContext) {
  server.resource(
    "website",
    "aurora://website",
    {
      description:
        "Active website metadata (includes siteKey for frontend env).",
      mimeType: "application/json",
    },
    async (uri) => {
      const website = requireActiveWebsite(ctx);
      return textResource(
        uri.href,
        JSON.stringify(
          {
            id: website.id,
            name: website.name,
            description: website.description,
            siteKey: website.siteKey,
            allowedOrigins: website.allowedOrigins,
            locales: website.locales,
            defaultLocale: website.defaultLocale,
            role: ctx.role,
          },
          null,
          2,
        ),
      );
    },
  );

  server.resource(
    "content-types",
    "aurora://content-types",
    {
      description: "All content types + fields for the authenticated website.",
      mimeType: "application/json",
    },
    async (uri) => {
      const types = await ctx.client.listAdminContentTypes();
      return textResource(uri.href, JSON.stringify(types, null, 2));
    },
  );

  server.resource(
    "content-type",
    new ResourceTemplate("aurora://content-types/{apiId}", {
      list: undefined,
    }),
    {
      description: "One content type by apiId.",
      mimeType: "application/json",
    },
    async (uri, vars) => {
      const apiId = String(vars.apiId ?? "");
      if (!apiId) throw new Error("Missing content type apiId in URI");
      const ct = await ctx.client.getContentType(apiId);
      return textResource(uri.href, JSON.stringify(ct, null, 2));
    },
  );

  if (ctx.publicEnabled) {
    server.resource(
      "openapi",
      "aurora://openapi",
      {
        description: "Public OpenAPI document (same tenant site key).",
        mimeType: "application/json",
      },
      async (uri) => {
        const doc = await ctx.client.getOpenApi();
        return textResource(uri.href, JSON.stringify(doc, null, 2));
      },
    );

    server.resource(
      "content-type-schema",
      new ResourceTemplate("aurora://content-types/{apiId}/schema", {
        list: undefined,
      }),
      {
        description: "JSON Schema for entry.fields of a content type.",
        mimeType: "application/json",
      },
      async (uri, vars) => {
        const apiId = String(vars.apiId ?? "");
        if (!apiId) throw new Error("Missing content type apiId");
        const schema = await ctx.client.getContentTypeSchema(apiId);
        return textResource(uri.href, JSON.stringify(schema, null, 2));
      },
    );
  }
}
