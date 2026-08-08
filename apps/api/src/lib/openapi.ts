import type { FieldType } from "@cms/shared";
import { defaultContentFormat } from "@cms/shared";
import { serializeFieldSettings } from "./fieldSettings.js";

type FieldRow = {
  apiId: string;
  name: string;
  type: FieldType | string;
  required: boolean;
  settings: unknown;
};

/** JSON Schema draft-07-ish object describing entry.fields for a content type. */
export function contentTypeJsonSchema(
  apiId: string,
  name: string,
  fields: FieldRow[],
) {
  const properties: Record<string, unknown> = {
    slug: {
      type: "string",
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
      description: "Entry URL slug (top-level, not inside fields)",
    },
  };
  const required: string[] = [];

  for (const f of fields) {
    if (f.apiId === "slug") continue;
    const settings = serializeFieldSettings(f.type, f.settings);
    properties[f.apiId] = fieldToJsonSchema(
      f,
      settings.contentFormat ?? defaultContentFormat(f.type as FieldType),
    );
    if (f.required) required.push(f.apiId);
  }

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `aurora:content-type:${apiId}`,
    title: name,
    type: "object",
    description: `Field values for content type "${apiId}" (FlatEntry.fields)`,
    properties,
    required,
    additionalProperties: false,
  };
}

function fieldToJsonSchema(
  field: FieldRow,
  contentFormat: string,
): Record<string, unknown> {
  const base = {
    title: field.name,
    description: `Field type ${field.type}; contentFormat=${contentFormat}`,
  };
  switch (field.type as FieldType) {
    case "boolean":
      return { ...base, type: "boolean" };
    case "number":
      return { ...base, type: "number" };
    case "datetime":
      return { ...base, type: "string", format: "date-time" };
    case "relations":
      return {
        ...base,
        type: "array",
        items: { type: "string", description: "Related entry slug" },
      };
    case "media":
      return {
        ...base,
        oneOf: [
          { type: "string", description: "Legacy URL string" },
          {
            type: "object",
            properties: {
              url: { type: "string" },
              alt: { type: "string" },
              width: { type: ["integer", "null"] },
              height: { type: ["integer", "null"] },
              mimeType: { type: ["string", "null"] },
            },
            required: ["url"],
          },
        ],
      };
    case "richtext":
      return {
        ...base,
        type: "string",
        contentMediaType:
          contentFormat === "html" ? "text/html" : "text/plain",
        "x-aurora-contentFormat": contentFormat || defaultContentFormat("richtext"),
      };
    case "textarea":
    case "text":
    case "slug":
    case "username":
    case "relation":
      return {
        ...base,
        type: "string",
        "x-aurora-contentFormat": contentFormat,
      };
    case "password":
      return {
        ...base,
        description: `${base.description}; write-only plaintext, stored hashed; reads return { set: true } or null; verify via management POST …/verify-password`,
        oneOf: [
          { type: "string", description: "New password plaintext (write only)" },
          {
            type: "object",
            properties: { set: { type: "boolean", const: true } },
            required: ["set"],
            description: "Password is set (read only)",
          },
          { type: "null" },
        ],
      };
    default:
      return {
        ...base,
        type: "string",
        "x-aurora-contentFormat": contentFormat,
      };
  }
}

/** Hand-maintained OpenAPI 3 document for the public surface. */
export function publicOpenApiDocument(baseUrl: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: "Aurora CMS Public API",
      version: "1",
      description:
        "Site-key scoped published content, forms, bootstrap, and CORS check. Header x-site-key required on /api/v1/* (except openapi/cors-check/health).",
    },
    servers: [{ url: baseUrl }],
    components: {
      securitySchemes: {
        SiteKey: {
          type: "apiKey",
          in: "header",
          name: "x-site-key",
        },
      },
      schemas: {
        FlatEntry: {
          type: "object",
          required: [
            "id",
            "slug",
            "contentType",
            "status",
            "locale",
            "fields",
            "publishedAt",
            "createdAt",
            "updatedAt",
          ],
          properties: {
            id: { type: "string" },
            slug: { type: "string" },
            contentType: { type: "string" },
            status: { type: "string", enum: ["draft", "published"] },
            locale: { type: "string" },
            fields: { type: "object", additionalProperties: true },
            publishedAt: { type: ["string", "null"] },
            createdAt: { type: "string" },
            updatedAt: { type: "string" },
          },
        },
        ApiError: {
          type: "object",
          required: ["message", "code"],
          properties: {
            message: { type: "string" },
            code: { type: "string" },
            requestId: {
              type: "string",
              description:
                "Same value as response header X-Request-Id; use to correlate with API Docker logs",
            },
            issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  path: { type: "array", items: {} },
                  code: { type: "string" },
                  message: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    security: [{ SiteKey: [] }],
    paths: {
      "/health": {
        get: {
          security: [],
          summary: "Health check",
          responses: { "200": { description: "OK" } },
        },
      },
      "/api/v1/openapi.json": {
        get: {
          security: [],
          summary: "OpenAPI document",
          responses: { "200": { description: "OpenAPI 3 JSON" } },
        },
      },
      "/api/v1/cors-check": {
        get: {
          security: [],
          summary: "Check whether an Origin would be allowed",
          parameters: [
            {
              name: "origin",
              in: "query",
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "CORS diagnosis" } },
        },
      },
      "/api/v1/bootstrap": {
        get: {
          summary: "Site chrome + home in one roundtrip",
          responses: { "200": { description: "Bootstrap payload" } },
        },
      },
      "/api/v1/content-types": {
        get: {
          summary: "List content types",
          responses: { "200": { description: "ContentType[]" } },
        },
      },
      "/api/v1/content-types/{apiId}": {
        get: {
          summary: "Get content type",
          parameters: [
            { name: "apiId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "ContentType" } },
        },
      },
      "/api/v1/content-types/{apiId}/schema.json": {
        get: {
          summary: "JSON Schema for entry fields",
          parameters: [
            { name: "apiId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "JSON Schema" } },
        },
      },
      "/api/v1/content-types/{apiId}/entries": {
        get: {
          summary: "List published entries",
          parameters: [
            { name: "apiId", in: "path", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
            { name: "slug", in: "query", schema: { type: "string" } },
            {
              name: "sort",
              in: "query",
              schema: {
                type: "string",
                enum: ["publishedAt", "createdAt", "updatedAt", "sortOrder"],
              },
            },
            {
              name: "order",
              in: "query",
              schema: { type: "string", enum: ["asc", "desc"] },
            },
          ],
          responses: { "200": { description: "Paginated entries" } },
        },
      },
      "/api/v1/content-types/{apiId}/entries/{slug}": {
        get: {
          summary: "Get published entry (or draft with previewToken)",
          parameters: [
            { name: "apiId", in: "path", required: true, schema: { type: "string" } },
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            { name: "previewToken", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "FlatEntry",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/FlatEntry" },
                },
              },
            },
          },
        },
      },
      "/api/v1/forms/{apiId}": {
        get: {
          summary: "Get public form definition",
          parameters: [
            { name: "apiId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Form" } },
        },
      },
      "/api/v1/forms/{apiId}/submit": {
        post: {
          summary: "Submit a form",
          parameters: [
            { name: "apiId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Success" },
            "400": {
              description: "Validation failed",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApiError" },
                },
              },
            },
          },
        },
      },
    },
  };
}
