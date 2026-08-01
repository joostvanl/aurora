import {
  FieldType,
  EntryStatus,
  FormFieldType,
  type Prisma,
  type WebsiteRole,
} from "@prisma/client";
import { prisma } from "../db.js";
import { hooks } from "../core/hooks.js";
import { roleAtLeast, RolePermission } from "../auth/roles.js";
import {
  entryInclude,
  getContentTypeOrThrow,
  setEntryFields,
} from "../lib/entries.js";
import {
  formInclude,
  getFormOrThrow,
  serializeForm,
  serializeFormSubmission,
} from "../lib/forms.js";
import { serializeContentType, serializeEntry } from "../lib/serialize.js";
import { applyStrReplace } from "./patches.js";
import type { ChatTool } from "./openai.js";

/** Schema-mutating tools require builder+; everything else is content (editor+). */
export const SCHEMA_TOOLS = new Set([
  "create_content_type",
  "update_content_type",
  "delete_content_type",
  "create_field",
  "update_field",
  "delete_field",
  "create_form",
  "update_form",
  "delete_form",
  "create_form_field",
  "update_form_field",
  "delete_form_field",
]);

/** Content-model tools that affect how a frontend should render CMS data. */
export const CONTENT_SCHEMA_TOOLS = new Set([
  "create_content_type",
  "update_content_type",
  "delete_content_type",
  "create_field",
  "update_field",
  "delete_field",
]);

export type ToolResult = {
  name: string;
  ok: boolean;
  summary: string;
  data?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function str(value: unknown, key: string): string | undefined {
  const v = asRecord(value)[key];
  return typeof v === "string" ? v : undefined;
}

function num(value: unknown, key: string): number | undefined {
  const v = asRecord(value)[key];
  return typeof v === "number" ? v : undefined;
}

function bool(value: unknown, key: string): boolean | undefined {
  const v = asRecord(value)[key];
  return typeof v === "boolean" ? v : undefined;
}

export const aiTools: ChatTool[] = [
  {
    type: "function",
    function: {
      name: "list_content_types",
      description: "List all content types with their fields.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_content_type",
      description: "Get one content type by apiId.",
      parameters: {
        type: "object",
        properties: { apiId: { type: "string" } },
        required: ["apiId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_content_type",
      description: "Create a content type.",
      parameters: {
        type: "object",
        properties: {
          apiId: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
        },
        required: ["apiId", "name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_content_type",
      description: "Update content type name/description.",
      parameters: {
        type: "object",
        properties: {
          apiId: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
        },
        required: ["apiId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_content_type",
      description: "Delete a content type and its entries.",
      parameters: {
        type: "object",
        properties: { apiId: { type: "string" } },
        required: ["apiId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_field",
      description: "Add a field definition to a content type.",
      parameters: {
        type: "object",
        properties: {
          contentTypeApiId: { type: "string" },
          apiId: { type: "string" },
          name: { type: "string" },
          type: {
            type: "string",
            enum: [
              "text",
              "textarea",
              "richtext",
              "boolean",
              "datetime",
              "number",
              "slug",
              "media",
            ],
          },
          required: { type: "boolean" },
          sortOrder: { type: "number" },
        },
        required: ["contentTypeApiId", "apiId", "name", "type"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_field",
      description: "Update a field definition.",
      parameters: {
        type: "object",
        properties: {
          contentTypeApiId: { type: "string" },
          fieldApiId: { type: "string" },
          name: { type: "string" },
          type: {
            type: "string",
            enum: [
              "text",
              "textarea",
              "richtext",
              "boolean",
              "datetime",
              "number",
              "slug",
              "media",
            ],
          },
          required: { type: "boolean" },
          sortOrder: { type: "number" },
        },
        required: ["contentTypeApiId", "fieldApiId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_field",
      description: "Delete a field definition.",
      parameters: {
        type: "object",
        properties: {
          contentTypeApiId: { type: "string" },
          fieldApiId: { type: "string" },
        },
        required: ["contentTypeApiId", "fieldApiId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_entries",
      description: "List entries for a content type (admin, includes drafts).",
      parameters: {
        type: "object",
        properties: {
          contentTypeApiId: { type: "string" },
          limit: { type: "number" },
          status: { type: "string", enum: ["draft", "published"] },
          slug: { type: "string" },
        },
        required: ["contentTypeApiId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_entry",
      description: "Get an entry by id or slug.",
      parameters: {
        type: "object",
        properties: {
          contentTypeApiId: { type: "string" },
          entryId: { type: "string" },
          slug: { type: "string" },
        },
        required: ["contentTypeApiId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_entry",
      description:
        "Create a new CMS entry immediately (required when the user asks to create/write/make a page or post). Pass field values in `fields` in the same call — do not only draft text in chat. Prefer contentTypeApiId \"page\" for pages and \"post\" for blog posts. Richtext values must be HTML, never Markdown.",
      parameters: {
        type: "object",
        properties: {
          contentTypeApiId: { type: "string" },
          slug: { type: "string" },
          status: { type: "string", enum: ["draft", "published"] },
          fields: { type: "object", additionalProperties: true },
        },
        required: ["contentTypeApiId", "slug"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "str_replace",
      description:
        "Find/replace inside a string field value (Cursor-style). Prefer this over rewriting whole fields. old_string must be unique unless replace_all=true. For richtext fields, old_string/new_string must be HTML (never Markdown).",
      parameters: {
        type: "object",
        properties: {
          contentTypeApiId: { type: "string" },
          entryId: { type: "string" },
          fieldApiId: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
          replace_all: { type: "boolean" },
        },
        required: [
          "contentTypeApiId",
          "entryId",
          "fieldApiId",
          "old_string",
          "new_string",
        ],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_field",
      description:
        "Write/replace an entire field value. Use only when the field is empty or a full rewrite is necessary. Prefer str_replace for edits. For richtext fields, value MUST be HTML (e.g. <p>…</p>), never Markdown.",
      parameters: {
        type: "object",
        properties: {
          contentTypeApiId: { type: "string" },
          entryId: { type: "string" },
          fieldApiId: { type: "string" },
          value: {},
        },
        required: ["contentTypeApiId", "entryId", "fieldApiId", "value"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_entry_meta",
      description: "Update entry slug and/or status.",
      parameters: {
        type: "object",
        properties: {
          contentTypeApiId: { type: "string" },
          entryId: { type: "string" },
          slug: { type: "string" },
          status: { type: "string", enum: ["draft", "published"] },
        },
        required: ["contentTypeApiId", "entryId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "publish_entry",
      description: "Publish an entry.",
      parameters: {
        type: "object",
        properties: {
          contentTypeApiId: { type: "string" },
          entryId: { type: "string" },
        },
        required: ["contentTypeApiId", "entryId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "unpublish_entry",
      description: "Unpublish an entry (back to draft).",
      parameters: {
        type: "object",
        properties: {
          contentTypeApiId: { type: "string" },
          entryId: { type: "string" },
        },
        required: ["contentTypeApiId", "entryId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_entry",
      description: "Delete an entry.",
      parameters: {
        type: "object",
        properties: {
          contentTypeApiId: { type: "string" },
          entryId: { type: "string" },
        },
        required: ["contentTypeApiId", "entryId"],
        additionalProperties: false,
      },
    },
  },
  // --- Forms module ---
  {
    type: "function",
    function: {
      name: "list_forms",
      description: "List all forms with their field definitions.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_form",
      description: "Get one form by apiId, including fields.",
      parameters: {
        type: "object",
        properties: { apiId: { type: "string" } },
        required: ["apiId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_form",
      description:
        "Create a form (separate from content types). Use for contact/lead/survey forms.",
      parameters: {
        type: "object",
        properties: {
          apiId: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          submitLabel: { type: "string" },
          successMessage: { type: "string" },
          enabled: { type: "boolean" },
        },
        required: ["apiId", "name"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_form",
      description:
        "Update form settings (name, description, submitLabel, successMessage, enabled).",
      parameters: {
        type: "object",
        properties: {
          apiId: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          submitLabel: { type: "string" },
          successMessage: { type: "string" },
          enabled: { type: "boolean" },
        },
        required: ["apiId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_form",
      description: "Delete a form and all of its submissions.",
      parameters: {
        type: "object",
        properties: { apiId: { type: "string" } },
        required: ["apiId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_form_field",
      description: "Add a field to a form.",
      parameters: {
        type: "object",
        properties: {
          formApiId: { type: "string" },
          apiId: { type: "string" },
          label: { type: "string" },
          type: {
            type: "string",
            enum: [
              "text",
              "email",
              "phone",
              "textarea",
              "number",
              "select",
              "radio",
              "checkbox",
              "honeypot",
            ],
          },
          required: { type: "boolean" },
          placeholder: { type: "string" },
          helpText: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                value: { type: "string" },
                label: { type: "string" },
              },
              required: ["value", "label"],
            },
            description: "Required for select/radio: [{value,label}, …]",
          },
          sortOrder: { type: "number" },
        },
        required: ["formApiId", "apiId", "label", "type"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_form_field",
      description: "Update a form field definition.",
      parameters: {
        type: "object",
        properties: {
          formApiId: { type: "string" },
          fieldApiId: { type: "string" },
          label: { type: "string" },
          type: {
            type: "string",
            enum: [
              "text",
              "email",
              "phone",
              "textarea",
              "number",
              "select",
              "radio",
              "checkbox",
              "honeypot",
            ],
          },
          required: { type: "boolean" },
          placeholder: { type: "string" },
          helpText: { type: "string" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                value: { type: "string" },
                label: { type: "string" },
              },
              required: ["value", "label"],
            },
          },
          sortOrder: { type: "number" },
        },
        required: ["formApiId", "fieldApiId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_form_field",
      description: "Delete a form field.",
      parameters: {
        type: "object",
        properties: {
          formApiId: { type: "string" },
          fieldApiId: { type: "string" },
        },
        required: ["formApiId", "fieldApiId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_form_submissions",
      description:
        "List form submissions (inbox). Use for insights: who submitted what. Prefer unreadOnly when triaging.",
      parameters: {
        type: "object",
        properties: {
          formApiId: { type: "string" },
          limit: { type: "number" },
          offset: { type: "number" },
          unreadOnly: { type: "boolean" },
        },
        required: ["formApiId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_form_submission",
      description: "Get one submission with full payload and meta.",
      parameters: {
        type: "object",
        properties: {
          formApiId: { type: "string" },
          submissionId: { type: "string" },
        },
        required: ["formApiId", "submissionId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "form_submission_stats",
      description:
        "Aggregate inbox insights for a form: totals, unread count, and a sample of recent payloads. Use this first when asked for insights/overview.",
      parameters: {
        type: "object",
        properties: {
          formApiId: { type: "string" },
          sampleLimit: {
            type: "number",
            description: "How many recent submissions to include (max 25)",
          },
        },
        required: ["formApiId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_form_submission_read",
      description: "Mark a submission as read or unread.",
      parameters: {
        type: "object",
        properties: {
          formApiId: { type: "string" },
          submissionId: { type: "string" },
          read: { type: "boolean" },
        },
        required: ["formApiId", "submissionId", "read"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_form_submission",
      description: "Delete a form submission.",
      parameters: {
        type: "object",
        properties: {
          formApiId: { type: "string" },
          submissionId: { type: "string" },
        },
        required: ["formApiId", "submissionId"],
        additionalProperties: false,
      },
    },
  },
];

export async function executeAiTool(
  name: string,
  rawArgs: unknown,
  ctx: {
    websiteId: string;
    role: WebsiteRole;
    ensureAiSnapshot?: (entryId: string, label?: string) => Promise<unknown>;
  },
): Promise<ToolResult> {
  const { websiteId, role } = ctx;
  const ensureSnapshot = async (entryId: string | undefined) => {
    if (entryId && ctx.ensureAiSnapshot) {
      await ctx.ensureAiSnapshot(entryId);
    }
  };

  if (SCHEMA_TOOLS.has(name) && !roleAtLeast(role, RolePermission.schema)) {
    return {
      name,
      ok: false,
      summary: `Permission denied: "${name}" requires builder or admin role`,
    };
  }

  try {
    switch (name) {
      case "list_content_types": {
        const items = await prisma.contentType.findMany({
          where: { websiteId },
          include: { fields: { orderBy: { sortOrder: "asc" } } },
          orderBy: { name: "asc" },
        });
        const data = items.map(serializeContentType);
        return {
          name,
          ok: true,
          summary: `Listed ${data.length} content types`,
          data,
        };
      }
      case "get_content_type": {
        const apiId = str(rawArgs, "apiId");
        if (!apiId) throw new Error("apiId required");
        const ct = await getContentTypeOrThrow(apiId, websiteId);
        return {
          name,
          ok: true,
          summary: `Loaded content type ${apiId}`,
          data: serializeContentType(ct),
        };
      }
      case "create_content_type": {
        const apiId = str(rawArgs, "apiId");
        const nameValue = str(rawArgs, "name");
        if (!apiId || !nameValue) throw new Error("apiId and name required");
        const ct = await prisma.contentType.create({
          data: {
            websiteId,
            apiId,
            name: nameValue,
            description: str(rawArgs, "description"),
          },
          include: { fields: { orderBy: { sortOrder: "asc" } } },
        });
        return {
          name,
          ok: true,
          summary: `Created content type ${apiId}`,
          data: serializeContentType(ct),
        };
      }
      case "update_content_type": {
        const apiId = str(rawArgs, "apiId");
        if (!apiId) throw new Error("apiId required");
        await getContentTypeOrThrow(apiId, websiteId);
        const ct = await prisma.contentType.update({
          where: { websiteId_apiId: { websiteId, apiId } },
          data: {
            ...(str(rawArgs, "name") ? { name: str(rawArgs, "name") } : {}),
            ...(str(rawArgs, "description") !== undefined
              ? { description: str(rawArgs, "description") ?? null }
              : {}),
          },
          include: { fields: { orderBy: { sortOrder: "asc" } } },
        });
        return {
          name,
          ok: true,
          summary: `Updated content type ${apiId}`,
          data: serializeContentType(ct),
        };
      }
      case "delete_content_type": {
        const apiId = str(rawArgs, "apiId");
        if (!apiId) throw new Error("apiId required");
        await getContentTypeOrThrow(apiId, websiteId);
        await prisma.contentType.delete({ where: { websiteId_apiId: { websiteId, apiId } } });
        return { name, ok: true, summary: `Deleted content type ${apiId}` };
      }
      case "create_field": {
        const contentTypeApiId = str(rawArgs, "contentTypeApiId");
        const apiId = str(rawArgs, "apiId");
        const fieldName = str(rawArgs, "name");
        const type = str(rawArgs, "type") as FieldType | undefined;
        if (!contentTypeApiId || !apiId || !fieldName || !type) {
          throw new Error("contentTypeApiId, apiId, name, type required");
        }
        const ct = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        const maxOrder = ct.fields.reduce((m, f) => Math.max(m, f.sortOrder), -1);
        await prisma.fieldDefinition.create({
          data: {
            contentTypeId: ct.id,
            apiId,
            name: fieldName,
            type,
            required: bool(rawArgs, "required") ?? false,
            sortOrder: num(rawArgs, "sortOrder") ?? maxOrder + 1,
          },
        });
        const updated = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        return {
          name,
          ok: true,
          summary: `Added field ${apiId} to ${contentTypeApiId}`,
          data: serializeContentType(updated),
        };
      }
      case "update_field": {
        const contentTypeApiId = str(rawArgs, "contentTypeApiId");
        const fieldApiId = str(rawArgs, "fieldApiId");
        if (!contentTypeApiId || !fieldApiId) {
          throw new Error("contentTypeApiId and fieldApiId required");
        }
        const ct = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        const field = ct.fields.find((f) => f.apiId === fieldApiId);
        if (!field) throw new Error("Field not found");
        await prisma.fieldDefinition.update({
          where: { id: field.id },
          data: {
            ...(str(rawArgs, "name") ? { name: str(rawArgs, "name") } : {}),
            ...(str(rawArgs, "type")
              ? { type: str(rawArgs, "type") as FieldType }
              : {}),
            ...(bool(rawArgs, "required") !== undefined
              ? { required: bool(rawArgs, "required") }
              : {}),
            ...(num(rawArgs, "sortOrder") !== undefined
              ? { sortOrder: num(rawArgs, "sortOrder") }
              : {}),
          },
        });
        const updated = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        return {
          name,
          ok: true,
          summary: `Updated field ${fieldApiId}`,
          data: serializeContentType(updated),
        };
      }
      case "delete_field": {
        const contentTypeApiId = str(rawArgs, "contentTypeApiId");
        const fieldApiId = str(rawArgs, "fieldApiId");
        if (!contentTypeApiId || !fieldApiId) {
          throw new Error("contentTypeApiId and fieldApiId required");
        }
        const ct = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        const field = ct.fields.find((f) => f.apiId === fieldApiId);
        if (!field) throw new Error("Field not found");
        await prisma.fieldDefinition.delete({ where: { id: field.id } });
        const updated = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        return {
          name,
          ok: true,
          summary: `Deleted field ${fieldApiId}`,
          data: serializeContentType(updated),
        };
      }
      case "list_entries": {
        const contentTypeApiId = str(rawArgs, "contentTypeApiId");
        if (!contentTypeApiId) throw new Error("contentTypeApiId required");
        const ct = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        const limit = Math.min(num(rawArgs, "limit") ?? 20, 50);
        const status = str(rawArgs, "status") as EntryStatus | undefined;
        const slug = str(rawArgs, "slug");
        const where = {
          contentTypeId: ct.id,
          ...(status ? { status } : {}),
          ...(slug ? { slug } : {}),
        };
        const items = await prisma.entry.findMany({
          where,
          include: entryInclude,
          orderBy: { updatedAt: "desc" },
          take: limit,
        });
        return {
          name,
          ok: true,
          summary: `Listed ${items.length} entries for ${contentTypeApiId}`,
          data: items.map(serializeEntry),
        };
      }
      case "get_entry": {
        const contentTypeApiId = str(rawArgs, "contentTypeApiId");
        if (!contentTypeApiId) throw new Error("contentTypeApiId required");
        const ct = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        const entryId = str(rawArgs, "entryId");
        const slug = str(rawArgs, "slug");
        const entry = await prisma.entry.findFirst({
          where: {
            contentTypeId: ct.id,
            ...(entryId ? { id: entryId } : {}),
            ...(slug ? { slug } : {}),
          },
          include: entryInclude,
        });
        if (!entry) throw new Error("Entry not found");
        return {
          name,
          ok: true,
          summary: `Loaded entry ${entry.slug}`,
          data: serializeEntry(entry),
        };
      }
      case "create_entry": {
        const contentTypeApiId = str(rawArgs, "contentTypeApiId");
        const slug = str(rawArgs, "slug");
        if (!contentTypeApiId || !slug) {
          throw new Error("contentTypeApiId and slug required");
        }
        const ct = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        const status =
          (str(rawArgs, "status") as EntryStatus | undefined) ?? EntryStatus.draft;
        const fields = asRecord(asRecord(rawArgs).fields);
        const entry = await prisma.entry.create({
          data: {
            contentTypeId: ct.id,
            slug,
            status,
            publishedAt: status === EntryStatus.published ? new Date() : null,
          },
        });
        await setEntryFields(entry.id, ct.id, fields);
        const full = await prisma.entry.findUniqueOrThrow({
          where: { id: entry.id },
          include: entryInclude,
        });
        await hooks.emit("onEntryCreate", {
          entryId: full.id,
          contentTypeApiId: ct.apiId,
          slug: full.slug,
        });
        return {
          name,
          ok: true,
          summary: `Created entry ${slug} (${status})`,
          data: serializeEntry(full),
        };
      }
      case "str_replace": {
        const contentTypeApiId = str(rawArgs, "contentTypeApiId");
        const entryId = str(rawArgs, "entryId");
        const fieldApiId = str(rawArgs, "fieldApiId");
        const oldString = str(rawArgs, "old_string");
        const newString = str(rawArgs, "new_string");
        if (
          !contentTypeApiId ||
          !entryId ||
          !fieldApiId ||
          oldString === undefined ||
          newString === undefined
        ) {
          throw new Error(
            "contentTypeApiId, entryId, fieldApiId, old_string, new_string required",
          );
        }
        await ensureSnapshot(entryId);
        const ct = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        const field = ct.fields.find((f) => f.apiId === fieldApiId);
        if (!field) throw new Error("Field not found");
        const entry = await prisma.entry.findFirst({
          where: { id: entryId, contentTypeId: ct.id },
          include: entryInclude,
        });
        if (!entry) throw new Error("Entry not found");
        const current = entry.fieldValues.find((fv) => fv.fieldId === field.id);
        const currentValue = current?.value;
        if (typeof currentValue !== "string") {
          throw new Error(
            "str_replace only works on string field values; use write_field instead",
          );
        }
        const next = applyStrReplace(
          currentValue,
          oldString,
          newString,
          bool(rawArgs, "replace_all") ?? false,
        );
        await prisma.entryFieldValue.upsert({
          where: {
            entryId_fieldId: { entryId: entry.id, fieldId: field.id },
          },
          create: {
            entryId: entry.id,
            fieldId: field.id,
            value: next as Prisma.InputJsonValue,
          },
          update: { value: next as Prisma.InputJsonValue },
        });
        const full = await prisma.entry.findUniqueOrThrow({
          where: { id: entry.id },
          include: entryInclude,
        });
        await hooks.emit("onEntryUpdate", {
          entryId: full.id,
          contentTypeApiId: ct.apiId,
          slug: full.slug,
        });
        return {
          name,
          ok: true,
          summary: `Patched ${contentTypeApiId}/${entry.slug}.${fieldApiId}`,
          data: serializeEntry(full),
        };
      }
      case "write_field": {
        const contentTypeApiId = str(rawArgs, "contentTypeApiId");
        const entryId = str(rawArgs, "entryId");
        const fieldApiId = str(rawArgs, "fieldApiId");
        if (!contentTypeApiId || !entryId || !fieldApiId) {
          throw new Error("contentTypeApiId, entryId, fieldApiId required");
        }
        if (!("value" in asRecord(rawArgs))) throw new Error("value required");
        await ensureSnapshot(entryId);
        const ct = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        const entry = await prisma.entry.findFirst({
          where: { id: entryId, contentTypeId: ct.id },
        });
        if (!entry) throw new Error("Entry not found");
        await setEntryFields(entry.id, ct.id, {
          [fieldApiId]: asRecord(rawArgs).value,
        });
        const full = await prisma.entry.findUniqueOrThrow({
          where: { id: entry.id },
          include: entryInclude,
        });
        await hooks.emit("onEntryUpdate", {
          entryId: full.id,
          contentTypeApiId: ct.apiId,
          slug: full.slug,
        });
        return {
          name,
          ok: true,
          summary: `Wrote ${contentTypeApiId}/${entry.slug}.${fieldApiId}`,
          data: serializeEntry(full),
        };
      }
      case "update_entry_meta": {
        const contentTypeApiId = str(rawArgs, "contentTypeApiId");
        const entryId = str(rawArgs, "entryId");
        if (!contentTypeApiId || !entryId) {
          throw new Error("contentTypeApiId and entryId required");
        }
        await ensureSnapshot(entryId);
        const ct = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        const existing = await prisma.entry.findFirst({
          where: { id: entryId, contentTypeId: ct.id },
        });
        if (!existing) throw new Error("Entry not found");
        const status = str(rawArgs, "status") as EntryStatus | undefined;
        const slug = str(rawArgs, "slug");
        const full = await prisma.entry.update({
          where: { id: existing.id },
          data: {
            ...(slug ? { slug } : {}),
            ...(status
              ? {
                  status,
                  publishedAt:
                    status === EntryStatus.published
                      ? (existing.publishedAt ?? new Date())
                      : null,
                }
              : {}),
          },
          include: entryInclude,
        });
        return {
          name,
          ok: true,
          summary: `Updated meta for ${full.slug}`,
          data: serializeEntry(full),
        };
      }
      case "publish_entry":
      case "unpublish_entry": {
        const contentTypeApiId = str(rawArgs, "contentTypeApiId");
        const entryId = str(rawArgs, "entryId");
        if (!contentTypeApiId || !entryId) {
          throw new Error("contentTypeApiId and entryId required");
        }
        await ensureSnapshot(entryId);
        const ct = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        const existing = await prisma.entry.findFirst({
          where: { id: entryId, contentTypeId: ct.id },
        });
        if (!existing) throw new Error("Entry not found");
        const publish = name === "publish_entry";
        const full = await prisma.entry.update({
          where: { id: existing.id },
          data: {
            status: publish ? EntryStatus.published : EntryStatus.draft,
            publishedAt: publish ? (existing.publishedAt ?? new Date()) : null,
          },
          include: entryInclude,
        });
        await hooks.emit(publish ? "onEntryPublish" : "onEntryUnpublish", {
          entryId: full.id,
          contentTypeApiId: ct.apiId,
          slug: full.slug,
        });
        return {
          name,
          ok: true,
          summary: `${publish ? "Published" : "Unpublished"} ${full.slug}`,
          data: serializeEntry(full),
        };
      }
      case "delete_entry": {
        const contentTypeApiId = str(rawArgs, "contentTypeApiId");
        const entryId = str(rawArgs, "entryId");
        if (!contentTypeApiId || !entryId) {
          throw new Error("contentTypeApiId and entryId required");
        }
        const ct = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        const existing = await prisma.entry.findFirst({
          where: { id: entryId, contentTypeId: ct.id },
        });
        if (!existing) throw new Error("Entry not found");
        await prisma.entry.delete({ where: { id: existing.id } });
        return {
          name,
          ok: true,
          summary: `Deleted entry ${existing.slug}`,
        };
      }
      case "list_forms": {
        const items = await prisma.form.findMany({
          where: { websiteId },
          include: formInclude,
          orderBy: { name: "asc" },
        });
        const data = items.map(serializeForm);
        return {
          name,
          ok: true,
          summary: `Listed ${data.length} forms`,
          data,
        };
      }
      case "get_form": {
        const apiId = str(rawArgs, "apiId");
        if (!apiId) throw new Error("apiId required");
        const form = await getFormOrThrow(apiId, websiteId);
        return {
          name,
          ok: true,
          summary: `Loaded form ${apiId}`,
          data: serializeForm(form),
        };
      }
      case "create_form": {
        const apiId = str(rawArgs, "apiId");
        const formName = str(rawArgs, "name");
        if (!apiId || !formName) throw new Error("apiId and name required");
        const existing = await prisma.form.findUnique({
          where: { websiteId_apiId: { websiteId, apiId } },
        });
        if (existing) throw new Error(`Form "${apiId}" already exists`);
        const form = await prisma.form.create({
          data: {
            websiteId,
            apiId,
            name: formName,
            description: str(rawArgs, "description"),
            submitLabel: str(rawArgs, "submitLabel") ?? "Submit",
            successMessage:
              str(rawArgs, "successMessage") ??
              "Thanks — we received your message.",
            enabled: bool(rawArgs, "enabled") ?? true,
          },
          include: formInclude,
        });
        return {
          name,
          ok: true,
          summary: `Created form ${apiId}`,
          data: serializeForm(form),
        };
      }
      case "update_form": {
        const apiId = str(rawArgs, "apiId");
        if (!apiId) throw new Error("apiId required");
        await getFormOrThrow(apiId, websiteId);
        const form = await prisma.form.update({
          where: { websiteId_apiId: { websiteId, apiId } },
          data: {
            ...(str(rawArgs, "name") ? { name: str(rawArgs, "name") } : {}),
            ...(str(rawArgs, "description") !== undefined
              ? { description: str(rawArgs, "description") ?? null }
              : {}),
            ...(str(rawArgs, "submitLabel")
              ? { submitLabel: str(rawArgs, "submitLabel") }
              : {}),
            ...(str(rawArgs, "successMessage")
              ? { successMessage: str(rawArgs, "successMessage") }
              : {}),
            ...(bool(rawArgs, "enabled") !== undefined
              ? { enabled: bool(rawArgs, "enabled") }
              : {}),
          },
          include: formInclude,
        });
        return {
          name,
          ok: true,
          summary: `Updated form ${apiId}`,
          data: serializeForm(form),
        };
      }
      case "delete_form": {
        const apiId = str(rawArgs, "apiId");
        if (!apiId) throw new Error("apiId required");
        await getFormOrThrow(apiId, websiteId);
        await prisma.form.delete({
          where: { websiteId_apiId: { websiteId, apiId } },
        });
        return { name, ok: true, summary: `Deleted form ${apiId}` };
      }
      case "create_form_field": {
        const formApiId = str(rawArgs, "formApiId");
        const apiId = str(rawArgs, "apiId");
        const label = str(rawArgs, "label");
        const type = str(rawArgs, "type") as FormFieldType | undefined;
        if (!formApiId || !apiId || !label || !type) {
          throw new Error("formApiId, apiId, label, type required");
        }
        const form = await getFormOrThrow(formApiId, websiteId);
        const maxOrder = form.fields.reduce(
          (m, f) => Math.max(m, f.sortOrder),
          -1,
        );
        const optionsRaw = asRecord(rawArgs).options;
        await prisma.formField.create({
          data: {
            formId: form.id,
            apiId,
            label,
            type,
            required:
              type === "honeypot" ? false : (bool(rawArgs, "required") ?? false),
            placeholder: str(rawArgs, "placeholder") ?? null,
            helpText: str(rawArgs, "helpText") ?? null,
            options: (Array.isArray(optionsRaw)
              ? optionsRaw
              : null) as Prisma.InputJsonValue,
            sortOrder: num(rawArgs, "sortOrder") ?? maxOrder + 1,
          },
        });
        const updated = await getFormOrThrow(formApiId, websiteId);
        return {
          name,
          ok: true,
          summary: `Added form field ${apiId} to ${formApiId}`,
          data: serializeForm(updated),
        };
      }
      case "update_form_field": {
        const formApiId = str(rawArgs, "formApiId");
        const fieldApiId = str(rawArgs, "fieldApiId");
        if (!formApiId || !fieldApiId) {
          throw new Error("formApiId and fieldApiId required");
        }
        const form = await getFormOrThrow(formApiId, websiteId);
        const field = form.fields.find((f) => f.apiId === fieldApiId);
        if (!field) throw new Error("Form field not found");
        const nextType =
          (str(rawArgs, "type") as FormFieldType | undefined) ?? field.type;
        const optionsRaw = asRecord(rawArgs).options;
        await prisma.formField.update({
          where: { id: field.id },
          data: {
            ...(str(rawArgs, "label") ? { label: str(rawArgs, "label") } : {}),
            ...(str(rawArgs, "type")
              ? { type: str(rawArgs, "type") as FormFieldType }
              : {}),
            ...(bool(rawArgs, "required") !== undefined
              ? {
                  required:
                    nextType === "honeypot"
                      ? false
                      : bool(rawArgs, "required"),
                }
              : {}),
            ...(str(rawArgs, "placeholder") !== undefined
              ? { placeholder: str(rawArgs, "placeholder") ?? null }
              : {}),
            ...(str(rawArgs, "helpText") !== undefined
              ? { helpText: str(rawArgs, "helpText") ?? null }
              : {}),
            ...(optionsRaw !== undefined
              ? {
                  options: (Array.isArray(optionsRaw)
                    ? optionsRaw
                    : null) as Prisma.InputJsonValue,
                }
              : {}),
            ...(num(rawArgs, "sortOrder") !== undefined
              ? { sortOrder: num(rawArgs, "sortOrder") }
              : {}),
          },
        });
        const updated = await getFormOrThrow(formApiId, websiteId);
        return {
          name,
          ok: true,
          summary: `Updated form field ${fieldApiId}`,
          data: serializeForm(updated),
        };
      }
      case "delete_form_field": {
        const formApiId = str(rawArgs, "formApiId");
        const fieldApiId = str(rawArgs, "fieldApiId");
        if (!formApiId || !fieldApiId) {
          throw new Error("formApiId and fieldApiId required");
        }
        const form = await getFormOrThrow(formApiId, websiteId);
        const field = form.fields.find((f) => f.apiId === fieldApiId);
        if (!field) throw new Error("Form field not found");
        await prisma.formField.delete({ where: { id: field.id } });
        const updated = await getFormOrThrow(formApiId, websiteId);
        return {
          name,
          ok: true,
          summary: `Deleted form field ${fieldApiId}`,
          data: serializeForm(updated),
        };
      }
      case "list_form_submissions": {
        const formApiId = str(rawArgs, "formApiId");
        if (!formApiId) throw new Error("formApiId required");
        const form = await getFormOrThrow(formApiId, websiteId);
        const limit = Math.min(num(rawArgs, "limit") ?? 20, 50);
        const offset = Math.max(num(rawArgs, "offset") ?? 0, 0);
        const unreadOnly = bool(rawArgs, "unreadOnly") ?? false;
        const where = {
          formId: form.id,
          ...(unreadOnly ? { readAt: null } : {}),
        };
        const [items, total] = await Promise.all([
          prisma.formSubmission.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: limit,
            skip: offset,
          }),
          prisma.formSubmission.count({ where }),
        ]);
        return {
          name,
          ok: true,
          summary: `Listed ${items.length}/${total} submissions for ${formApiId}`,
          data: {
            items: items.map((s) => serializeFormSubmission(s, form.apiId)),
            total,
            limit,
            offset,
          },
        };
      }
      case "get_form_submission": {
        const formApiId = str(rawArgs, "formApiId");
        const submissionId = str(rawArgs, "submissionId");
        if (!formApiId || !submissionId) {
          throw new Error("formApiId and submissionId required");
        }
        const form = await getFormOrThrow(formApiId, websiteId);
        const submission = await prisma.formSubmission.findFirst({
          where: { id: submissionId, formId: form.id },
        });
        if (!submission) throw new Error("Submission not found");
        return {
          name,
          ok: true,
          summary: `Loaded submission ${submissionId}`,
          data: serializeFormSubmission(submission, form.apiId),
        };
      }
      case "form_submission_stats": {
        const formApiId = str(rawArgs, "formApiId");
        if (!formApiId) throw new Error("formApiId required");
        const form = await getFormOrThrow(formApiId, websiteId);
        const sampleLimit = Math.min(num(rawArgs, "sampleLimit") ?? 10, 25);
        const [total, unread, recent] = await Promise.all([
          prisma.formSubmission.count({ where: { formId: form.id } }),
          prisma.formSubmission.count({
            where: { formId: form.id, readAt: null },
          }),
          prisma.formSubmission.findMany({
            where: { formId: form.id },
            orderBy: { createdAt: "desc" },
            take: sampleLimit,
          }),
        ]);
        const fieldKeys = new Set<string>();
        for (const s of recent) {
          const payload =
            s.payload && typeof s.payload === "object" && !Array.isArray(s.payload)
              ? (s.payload as Record<string, unknown>)
              : {};
          for (const key of Object.keys(payload)) fieldKeys.add(key);
        }
        return {
          name,
          ok: true,
          summary: `Stats for ${formApiId}: ${total} total, ${unread} unread`,
          data: {
            formApiId: form.apiId,
            formName: form.name,
            total,
            unread,
            read: total - unread,
            fieldsSeen: [...fieldKeys],
            recent: recent.map((s) => serializeFormSubmission(s, form.apiId)),
          },
        };
      }
      case "mark_form_submission_read": {
        const formApiId = str(rawArgs, "formApiId");
        const submissionId = str(rawArgs, "submissionId");
        const read = bool(rawArgs, "read");
        if (!formApiId || !submissionId || read === undefined) {
          throw new Error("formApiId, submissionId, read required");
        }
        const form = await getFormOrThrow(formApiId, websiteId);
        const submission = await prisma.formSubmission.findFirst({
          where: { id: submissionId, formId: form.id },
        });
        if (!submission) throw new Error("Submission not found");
        const updated = await prisma.formSubmission.update({
          where: { id: submission.id },
          data: {
            readAt: read ? (submission.readAt ?? new Date()) : null,
          },
        });
        return {
          name,
          ok: true,
          summary: `Marked submission ${submissionId} as ${read ? "read" : "unread"}`,
          data: serializeFormSubmission(updated, form.apiId),
        };
      }
      case "delete_form_submission": {
        const formApiId = str(rawArgs, "formApiId");
        const submissionId = str(rawArgs, "submissionId");
        if (!formApiId || !submissionId) {
          throw new Error("formApiId and submissionId required");
        }
        const form = await getFormOrThrow(formApiId, websiteId);
        const submission = await prisma.formSubmission.findFirst({
          where: { id: submissionId, formId: form.id },
        });
        if (!submission) throw new Error("Submission not found");
        await prisma.formSubmission.delete({ where: { id: submission.id } });
        return {
          name,
          ok: true,
          summary: `Deleted submission ${submissionId}`,
        };
      }
      default:
        return {
          name,
          ok: false,
          summary: `Unknown tool: ${name}`,
        };
    }  } catch (error) {
    return {
      name,
      ok: false,
      summary: error instanceof Error ? error.message : "Tool failed",
    };
  }
}
