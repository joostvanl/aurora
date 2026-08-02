import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpContext } from "../client.js";
import { toolError, toolOk } from "../errors.js";

const fieldType = z.enum([
  "text",
  "textarea",
  "richtext",
  "boolean",
  "datetime",
  "number",
  "slug",
  "media",
  "relation",
  "relations",
]);

export function registerSchemaTools(server: McpServer, ctx: McpContext) {
  const { client } = ctx;

  server.tool(
    "list_content_types",
    "List content types and field definitions for the authenticated website (management).",
    {},
    async () => {
      try {
        return toolOk(await client.listAdminContentTypes());
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "get_content_type",
    "Get one content type by apiId (management).",
    { apiId: z.string().min(1) },
    async ({ apiId }) => {
      try {
        return toolOk(await client.getContentType(apiId));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "create_content_type",
    "Create a content type on the authenticated website.",
    {
      apiId: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
      name: z.string().min(1),
      description: z.string().optional(),
    },
    async (input) => {
      try {
        return toolOk(await client.createContentType(input));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "update_content_type",
    "Update content type name/description.",
    {
      apiId: z.string().min(1),
      name: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
    },
    async ({ apiId, ...body }) => {
      try {
        return toolOk(await client.updateContentType(apiId, body));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "delete_content_type",
    "Delete a content type and all its entries. Destructive.",
    { apiId: z.string().min(1) },
    async ({ apiId }) => {
      try {
        return toolOk(await client.deleteContentType(apiId));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "create_field",
    "Add a field definition to a content type. Relation fields need settings.relatedContentTypeApiId.",
    {
      contentTypeApiId: z.string().min(1),
      apiId: z.string().min(1).regex(/^[a-z][a-z0-9_]*$/),
      name: z.string().min(1),
      type: fieldType,
      required: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
      settings: z
        .object({
          relatedContentTypeApiId: z.string().optional(),
          contentFormat: z.enum(["html", "markdown", "plain"]).optional(),
        })
        .nullable()
        .optional(),
    },
    async ({ contentTypeApiId, ...input }) => {
      try {
        return toolOk(await client.createField(contentTypeApiId, input));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "update_field",
    "Update a field definition.",
    {
      contentTypeApiId: z.string().min(1),
      fieldApiId: z.string().min(1),
      name: z.string().min(1).optional(),
      type: fieldType.optional(),
      required: z.boolean().optional(),
      sortOrder: z.number().int().optional(),
      settings: z
        .object({
          relatedContentTypeApiId: z.string().optional(),
          contentFormat: z.enum(["html", "markdown", "plain"]).optional(),
        })
        .nullable()
        .optional(),
    },
    async ({ contentTypeApiId, fieldApiId, ...body }) => {
      try {
        return toolOk(
          await client.updateField(contentTypeApiId, fieldApiId, body),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "delete_field",
    "Delete a field definition from a content type.",
    {
      contentTypeApiId: z.string().min(1),
      fieldApiId: z.string().min(1),
    },
    async ({ contentTypeApiId, fieldApiId }) => {
      try {
        return toolOk(await client.deleteField(contentTypeApiId, fieldApiId));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
