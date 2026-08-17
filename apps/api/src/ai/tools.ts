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
  asCreatedByUserId,
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
import {
  assertLocaleOnWebsite,
  getWebsiteLocales,
} from "../lib/locales.js";
import { createAllLocaleSiblings } from "../lib/translations.js";
import { createEntryVersion } from "../lib/versions.js";
import {
  serializeScheduledTask,
  serializeScheduledTaskRun,
} from "../scheduledTasks/serialize.js";
import { applyStrReplace } from "./patches.js";
import type { ChatTool } from "./openai.js";
import { fetchPublicUrl, WebFetchError } from "./webFetch.js";
import { getCurrentDateTime } from "./currentTime.js";
import { resolveToolDomains, toolDomain } from "./toolScope.js";
import type { AiChatContext } from "@cms/shared";
import { listAuditEvents } from "../lib/audit.js";
import { listContentTypeVersions } from "../lib/contentTypeVersions.js";
import {
  diffContentTypeSnapshots,
  diffEntrySnapshots,
} from "../lib/snapshotDiff.js";
import { listEntryVersions } from "../lib/versions.js";

/** Schema tools require builder+ (mutations + schema version reads); else content (editor+). */
export const SCHEMA_TOOLS = new Set([
  "create_content_type",
  "update_content_type",
  "delete_content_type",
  "create_field",
  "update_field",
  "delete_field",
  "list_content_type_versions",
  "create_form",
  "update_form",
  "delete_form",
  "create_form_field",
  "update_form_field",
  "delete_form_field",
]);

/** Compact version list row — omit full snapshots for context budget. */
function compactVersionMeta(row: {
  id: string;
  label: string | null;
  source: string;
  actorKind: string | null;
  changeSummary: string | null;
  createdAt: string;
}) {
  return {
    id: row.id,
    label: row.label,
    source: row.source,
    actorKind: row.actorKind,
    changeSummary: row.changeSummary,
    createdAt: row.createdAt,
  };
}

/** Content-model tools that affect how a frontend should render CMS data. */
export const CONTENT_SCHEMA_TOOLS = new Set([
  "create_content_type",
  "update_content_type",
  "delete_content_type",
  "create_field",
  "update_field",
  "delete_field",
]);

/** Entry-level tools that address existing content by contentTypeApiId. */
export const ENTRY_CONTENT_TOOLS = new Set([
  "create_entry",
  "get_entry",
  "list_entries",
  "str_replace",
  "write_field",
  "publish_entry",
  "unpublish_entry",
  "delete_entry",
]);

/**
 * Reserved / meta apiIds a model sometimes hallucinates (e.g. "__schema")
 * when it means to change the content model instead of creating an entry.
 */
const PSEUDO_CONTENT_TYPE_API_IDS = new Set([
  "schema",
  "content_type",
  "contenttype",
  "content-type",
  "content_types",
  "contenttypes",
  "field",
  "fields",
]);

/** True when apiId is a meta/pseudo name that is never a real content type. */
export function isPseudoContentTypeApiId(
  apiId: string | undefined | null,
): boolean {
  if (!apiId) return false;
  const normalized = apiId.trim().toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith("__")) return true;
  return PSEUDO_CONTENT_TYPE_API_IDS.has(normalized);
}

/** Tools omitted / blocked for unattended scheduled-task runs (draft-only v1). */
export const SCHEDULED_TASK_BLOCKED_TOOLS = new Set([
  "publish_entry",
  "unpublish_entry",
]);

/**
 * Read-only scheduled-task inspection (builder+). Available in studio chat only —
 * omitted from unattended scheduled_task runs to avoid self-inspection loops.
 */
export const SCHEDULED_TASK_INSPECT_TOOLS = new Set([
  "list_scheduled_tasks",
  "get_scheduled_task",
  "list_scheduled_task_runs",
]);

export type ToolResult = {
  name: string;
  ok: boolean;
  summary: string;
  data?: unknown;
};

/** Payload passed to the optional audit hook after a successful mutation. */
export type AiToolAuditEvent = {
  action: string;
  resourceType: string;
  resourceId: string;
  summary: string;
  meta?: Record<string, unknown> | null;
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
              "relation",
              "relations",
              "username",
              "password",
            ],
          },
          required: { type: "boolean" },
          sortOrder: { type: "number" },
          relatedContentTypeApiId: {
            type: "string",
            description:
              "Required when type is relation or relations — apiId of the related content type",
          },
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
              "relation",
              "relations",
              "username",
              "password",
            ],
          },
          required: { type: "boolean" },
          sortOrder: { type: "number" },
          relatedContentTypeApiId: {
            type: "string",
            description:
              "For relation/relations fields — apiId of the related content type",
          },
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
      description:
        "List entries for a content type (admin, includes drafts). Defaults to the website defaultLocale unless locale is set (or allLocales=true).",
      parameters: {
        type: "object",
        properties: {
          contentTypeApiId: { type: "string" },
          limit: { type: "number" },
          status: { type: "string", enum: ["draft", "published"] },
          slug: { type: "string" },
          locale: {
            type: "string",
            description:
              "Locale filter (language-REGION). Defaults to website defaultLocale.",
          },
          allLocales: {
            type: "boolean",
            description: "When true, return entries across all site locales.",
          },
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
      description:
        "Get an entry by id or slug. Slug lookup uses the website defaultLocale unless locale is set.",
      parameters: {
        type: "object",
        properties: {
          contentTypeApiId: { type: "string" },
          entryId: { type: "string" },
          slug: { type: "string" },
          locale: {
            type: "string",
            description:
              "Locale for slug lookup. Defaults to website defaultLocale.",
          },
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
        "Create a new CMS entry immediately (required when the user asks to create/write/make a page or post). Pass field values in `fields` in the same call — do not only draft text in chat. Prefer contentTypeApiId \"page\" for pages and \"post\" for blog posts. Richtext values must be HTML, never Markdown. Omit locale to use the website defaultLocale — never invent unsupported locales like en-US.",
      parameters: {
        type: "object",
        properties: {
          contentTypeApiId: { type: "string" },
          slug: { type: "string" },
          status: { type: "string", enum: ["draft", "published"] },
          locale: {
            type: "string",
            description:
              "Optional. Must be one of the website locales. Defaults to website defaultLocale.",
          },
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
  {
    type: "function",
    function: {
      name: "fetch_url",
      description:
        "Fetch a public http(s) web page and return readable text plus outbound links. Use for research/scraping. Call again on relevant links from the previous result when you need more detail. Private/internal hosts are blocked.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Absolute http or https URL to fetch",
          },
          maxChars: {
            type: "number",
            description:
              "Optional max characters of extracted text (server-capped)",
          },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_scheduled_tasks",
      description:
        "List scheduled tasks for this website (id, name, enabled, schedule, next/last run, lastStatus). Use before analysing a specific task. Requires builder or admin. Does not create or change tasks.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_scheduled_task",
      description:
        "Load one scheduled task by id or exact name, including prompt, schedule, caps, lastError, and recent runs (summary, reply, ok, tokens, tools, stoppedReason). Use to explain what a task does or why a run failed. Requires builder or admin.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Task id (preferred when known).",
          },
          name: {
            type: "string",
            description: "Exact task name when id is unknown.",
          },
          runLimit: {
            type: "number",
            description: "Max recent runs to include (default 10, max 20).",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_scheduled_task_runs",
      description:
        "List recent runs for a scheduled task (ok, summary, full reply, tokens, tool counts, stoppedReason, timestamps). Prefer get_scheduled_task first; use this when you need more runs than the default. Requires builder or admin.",
      parameters: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          taskName: {
            type: "string",
            description: "Exact task name if taskId is unknown.",
          },
          limit: {
            type: "number",
            description: "Number of runs (default 5, max 20).",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_current_datetime",
      description:
        "Return the authoritative server current date/time in UTC and the agent local timezone (CMS_AGENT_TIMEZONE, default Europe/Amsterdam). Prefer the Current date/time block already in the system prompt; call this only when you need a refreshed clock mid-conversation.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_entry_versions",
      description:
        "List immutable entry versions (newest first): id, label, source, actorKind, changeSummary, createdAt. Does not return full snapshots — use diff_versions to compare two versions. Scope: this website only.",
      parameters: {
        type: "object",
        properties: {
          apiId: {
            type: "string",
            description: "Content type apiId.",
          },
          entryId: { type: "string" },
          limit: {
            type: "number",
            description: "Max versions (default 50, max 100).",
          },
          offset: {
            type: "number",
            description: "Pagination offset (default 0).",
          },
        },
        required: ["apiId", "entryId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_content_type_versions",
      description:
        "List immutable content-type (schema) versions (newest first): id, label, source, actorKind, changeSummary, createdAt. No full snapshots — use diff_versions. Requires builder or admin. Scope: this website only.",
      parameters: {
        type: "object",
        properties: {
          apiId: {
            type: "string",
            description: "Content type apiId.",
          },
          limit: {
            type: "number",
            description: "Max versions (default 50, max 100).",
          },
          offset: {
            type: "number",
            description: "Pagination offset (default 0).",
          },
        },
        required: ["apiId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "diff_versions",
      description:
        "Field-level diff between two version snapshots (entry or content type). Returns path/before/after changes. Both version ids must belong to the same scoped resource on this website.",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["entry", "content_type"],
            description: "Which version table to compare.",
          },
          apiId: {
            type: "string",
            description: "Content type apiId (scopes to this website).",
          },
          entryId: {
            type: "string",
            description: "Required when kind is entry.",
          },
          fromVersionId: { type: "string" },
          toVersionId: { type: "string" },
        },
        required: ["kind", "apiId", "fromVersionId", "toVersionId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_audit_events",
      description:
        "List audit trail events for this website (newest first). Optionally filter by resourceType and resourceId. Use for who/when questions; never invent actors or timestamps.",
      parameters: {
        type: "object",
        properties: {
          resourceType: {
            type: "string",
            description: 'e.g. "entry", "content_type".',
          },
          resourceId: { type: "string" },
          limit: {
            type: "number",
            description: "Max events (default 50, max 100).",
          },
          offset: {
            type: "number",
            description: "Pagination offset (default 0).",
          },
        },
        additionalProperties: false,
      },
    },
  },
];

/** Tool list for chatCompletion; scoped by source, role, and studio context. */
export function aiToolsForSource(
  source?: string,
  opts?: {
    allowPublish?: boolean;
    role?: WebsiteRole;
    context?: AiChatContext;
  },
): ChatTool[] {
  let tools = aiTools;

  if (source === "scheduled_task") {
    tools = tools.filter(
      (t) => !SCHEDULED_TASK_INSPECT_TOOLS.has(t.function.name),
    );
    if (!opts?.allowPublish) {
      tools = tools.filter(
        (t) => !SCHEDULED_TASK_BLOCKED_TOOLS.has(t.function.name),
      );
    }
  }

  if (opts?.role && !roleAtLeast(opts.role, RolePermission.schema)) {
    tools = tools.filter(
      (t) =>
        !SCHEMA_TOOLS.has(t.function.name) &&
        !SCHEDULED_TASK_INSPECT_TOOLS.has(t.function.name),
    );
  }

  const domains = resolveToolDomains(opts?.context, source);
  tools = tools.filter((t) => domains.has(toolDomain(t.function.name)));

  return tools;
}

export async function executeAiTool(
  name: string,
  rawArgs: unknown,
  ctx: {
    websiteId: string;
    role: WebsiteRole;
    /** Acting user (for entry createdBy). */
    userId?: string;
    /** Metering / policy source, e.g. "chat" | "scheduled_task". */
    source?: string;
    /** Scheduled-task opt-in: allow publish/unpublish tools. */
    allowPublish?: boolean;
    /** Explicit user approval required before content-type / field mutations. */
    schemaChangeConfirmed?: boolean;
    ensureAiSnapshot?: (entryId: string, label?: string) => Promise<unknown>;
    ensureAiContentTypeSnapshot?: (
      contentTypeId: string,
      options?: {
        label?: string;
        changeSummary?: string;
        createdByUserId?: string | null;
      },
    ) => Promise<unknown>;
    /** Fired after a successful mutative tool (not on blocked / failed tools). */
    recordAudit?: (event: AiToolAuditEvent) => Promise<void>;
  },
): Promise<ToolResult> {
  const { websiteId, role } = ctx;
  const createdByUserId = asCreatedByUserId(ctx.userId);
  const draftOnly = ctx.source === "scheduled_task" && !ctx.allowPublish;
  const ensureSnapshot = async (entryId: string | undefined) => {
    if (entryId && ctx.ensureAiSnapshot) {
      await ctx.ensureAiSnapshot(entryId);
    }
  };
  const ensureSchemaSnapshot = async (
    contentTypeId: string | undefined,
    options?: { label?: string; changeSummary?: string },
  ) => {
    if (contentTypeId && ctx.ensureAiContentTypeSnapshot) {
      await ctx.ensureAiContentTypeSnapshot(contentTypeId, {
        ...options,
        createdByUserId,
      });
    }
  };
  const auditMutation = async (event: AiToolAuditEvent) => {
    if (!ctx.recordAudit) return;
    await ctx.recordAudit({
      ...event,
      meta: { tool: name, ...(event.meta ?? {}) },
    });
  };

  if (draftOnly && SCHEDULED_TASK_BLOCKED_TOOLS.has(name)) {
    return {
      name,
      ok: false,
      summary:
        "Blocked: scheduled tasks are draft-only and cannot publish or unpublish entries.",
    };
  }

  if (
    ctx.source === "scheduled_task" &&
    SCHEDULED_TASK_INSPECT_TOOLS.has(name)
  ) {
    return {
      name,
      ok: false,
      summary:
        "Blocked: scheduled task runs cannot inspect the task registry (avoid self-inspection loops).",
    };
  }

  if (SCHEMA_TOOLS.has(name) && !roleAtLeast(role, RolePermission.schema)) {
    return {
      name,
      ok: false,
      summary: `Permission denied: "${name}" requires builder or admin role`,
    };
  }

  if (
    SCHEDULED_TASK_INSPECT_TOOLS.has(name) &&
    !roleAtLeast(role, RolePermission.schema)
  ) {
    return {
      name,
      ok: false,
      summary: `Permission denied: "${name}" requires builder or admin role`,
    };
  }

  if (CONTENT_SCHEMA_TOOLS.has(name) && !ctx.schemaChangeConfirmed) {
    return {
      name,
      ok: false,
      summary:
        "Blocked: content-structure changes need explicit user approval first. Explain the planned content-type/field change, ask for confirmation, and only call this tool after the user clearly approves (e.g. yes / ok / go ahead). Do NOT work around this by using entry tools (create_entry/write_field) or by inventing a content type — wait for the user's confirmation.",
      data: { needsConfirmation: true, tool: name },
    };
  }

  if (ENTRY_CONTENT_TOOLS.has(name)) {
    const requestedApiId = str(rawArgs, "contentTypeApiId");
    if (isPseudoContentTypeApiId(requestedApiId)) {
      return {
        name,
        ok: false,
        summary:
          `"${requestedApiId}" is not a content type. Entry tools like ${name} only work on real content types. ` +
          "To change the content model (add/remove types or fields), use the schema tools create_content_type / create_field / update_field / delete_field instead. " +
          "Call list_content_types to see which content types actually exist.",
        data: { invalidContentTypeApiId: requestedApiId, tool: name },
      };
    }
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
        await ensureSchemaSnapshot(ct.id, {
          label: "Created",
          changeSummary: "Content type created",
        });
        await auditMutation({
          action: "content_type.create",
          resourceType: "content_type",
          resourceId: ct.id,
          summary: `Created content type ${apiId}`,
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
        const existing = await getContentTypeOrThrow(apiId, websiteId);
        await ensureSchemaSnapshot(existing.id, {
          changeSummary: "Content type updated",
        });
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
        await auditMutation({
          action: "content_type.update",
          resourceType: "content_type",
          resourceId: ct.id,
          summary: `Updated content type ${apiId}`,
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
        const existing = await getContentTypeOrThrow(apiId, websiteId);
        await ensureSchemaSnapshot(existing.id, {
          changeSummary: "Content type deleted",
        });
        await prisma.contentType.delete({ where: { websiteId_apiId: { websiteId, apiId } } });
        await auditMutation({
          action: "content_type.delete",
          resourceType: "content_type",
          resourceId: existing.id,
          summary: `Deleted content type ${apiId}`,
        });
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
        const relatedContentTypeApiId = str(rawArgs, "relatedContentTypeApiId");
        if (
          (type === "relation" || type === "relations") &&
          !relatedContentTypeApiId
        ) {
          throw new Error(
            "relatedContentTypeApiId is required for relation and relations fields",
          );
        }
        const ct = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        await ensureSchemaSnapshot(ct.id, {
          changeSummary: `Field ${apiId} created`,
        });
        const maxOrder = ct.fields.reduce((m, f) => Math.max(m, f.sortOrder), -1);
        await prisma.fieldDefinition.create({
          data: {
            contentTypeId: ct.id,
            apiId,
            name: fieldName,
            type,
            required: bool(rawArgs, "required") ?? false,
            sortOrder: num(rawArgs, "sortOrder") ?? maxOrder + 1,
            ...(relatedContentTypeApiId
              ? { settings: { relatedContentTypeApiId } }
              : {}),
          },
        });
        const updated = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        await auditMutation({
          action: "field.create",
          resourceType: "content_type",
          resourceId: updated.id,
          summary: `Created field ${apiId} on ${contentTypeApiId}`,
          meta: { fieldApiId: apiId },
        });
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
        await ensureSchemaSnapshot(ct.id, {
          changeSummary: `Field ${fieldApiId} updated`,
        });
        const relatedContentTypeApiId = str(rawArgs, "relatedContentTypeApiId");
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
            ...(relatedContentTypeApiId
              ? { settings: { relatedContentTypeApiId } }
              : {}),
          },
        });
        const updated = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        await auditMutation({
          action: "field.update",
          resourceType: "content_type",
          resourceId: updated.id,
          summary: `Updated field ${fieldApiId} on ${contentTypeApiId}`,
          meta: { fieldApiId },
        });
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
        await ensureSchemaSnapshot(ct.id, {
          changeSummary: `Field ${fieldApiId} deleted`,
        });
        await prisma.fieldDefinition.delete({ where: { id: field.id } });
        const updated = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        await auditMutation({
          action: "field.delete",
          resourceType: "content_type",
          resourceId: updated.id,
          summary: `Deleted field ${fieldApiId} on ${contentTypeApiId}`,
          meta: { fieldApiId },
        });
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
        const website = await getWebsiteLocales(websiteId);
        const limit = Math.min(num(rawArgs, "limit") ?? 20, 50);
        const status = str(rawArgs, "status") as EntryStatus | undefined;
        const slug = str(rawArgs, "slug");
        const allLocales = bool(rawArgs, "allLocales") === true;
        const localeArg = str(rawArgs, "locale");
        let localeFilter: string | undefined;
        if (!allLocales) {
          localeFilter = localeArg ?? website.defaultLocale;
          assertLocaleOnWebsite(localeFilter, website);
        } else if (localeArg) {
          assertLocaleOnWebsite(localeArg, website);
          localeFilter = localeArg;
        }
        const where = {
          contentTypeId: ct.id,
          ...(status ? { status } : {}),
          ...(slug ? { slug } : {}),
          ...(localeFilter ? { locale: localeFilter } : {}),
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
          summary: `Listed ${items.length} entries for ${contentTypeApiId}${localeFilter ? ` (${localeFilter})` : " (all locales)"}`,
          data: items.map(serializeEntry),
        };
      }
      case "get_entry": {
        const contentTypeApiId = str(rawArgs, "contentTypeApiId");
        if (!contentTypeApiId) throw new Error("contentTypeApiId required");
        const ct = await getContentTypeOrThrow(contentTypeApiId, websiteId);
        const website = await getWebsiteLocales(websiteId);
        const entryId = str(rawArgs, "entryId");
        const slug = str(rawArgs, "slug");
        const localeArg = str(rawArgs, "locale");
        const locale =
          entryId ? localeArg : (localeArg ?? website.defaultLocale);
        if (locale) assertLocaleOnWebsite(locale, website);
        const entry = await prisma.entry.findFirst({
          where: {
            contentTypeId: ct.id,
            ...(entryId ? { id: entryId } : {}),
            ...(slug ? { slug } : {}),
            ...(locale && !entryId ? { locale } : {}),
          },
          include: entryInclude,
        });
        if (!entry) throw new Error("Entry not found");
        return {
          name,
          ok: true,
          summary: `Loaded entry ${entry.slug} (${entry.locale})`,
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
        const website = await getWebsiteLocales(websiteId);
        const locale = str(rawArgs, "locale") ?? website.defaultLocale;
        assertLocaleOnWebsite(locale, website);
        let status =
          (str(rawArgs, "status") as EntryStatus | undefined) ?? EntryStatus.draft;
        if (draftOnly && status === EntryStatus.published) {
          status = EntryStatus.draft;
        }
        const fields = asRecord(asRecord(rawArgs).fields);

        const existing = await prisma.entry.findUnique({
          where: {
            contentTypeId_slug_locale: {
              contentTypeId: ct.id,
              slug,
              locale,
            },
          },
        });
        if (existing) {
          throw new Error(
            `Slug "${slug}" already exists for locale ${locale}`,
          );
        }

        const entry = await prisma.entry.create({
          data: {
            contentTypeId: ct.id,
            slug,
            locale,
            status,
            publishedAt: status === EntryStatus.published ? new Date() : null,
            ...(createdByUserId ? { createdByUserId } : {}),
          },
        });
        await setEntryFields(entry.id, ct.id, fields, websiteId, locale);

        if (ct.localizationMode === "all_locales") {
          await createAllLocaleSiblings({
            websiteId,
            contentTypeId: ct.id,
            sourceEntryId: entry.id,
            sourceLocale: locale,
            locales: website.locales,
            createdByUserId,
          });
        }

        const full = await prisma.entry.findUniqueOrThrow({
          where: { id: entry.id },
          include: entryInclude,
        });
        await createEntryVersion({
          entryId: full.id,
          source: "ai",
          label: "Created",
          createdByUserId,
          actorKind: "ai",
          changeSummary: "Entry created",
        });
        await hooks.emit("onEntryCreate", {
          entryId: full.id,
          contentTypeApiId: ct.apiId,
          slug: full.slug,
        });
        await auditMutation({
          action: "entry.create",
          resourceType: "entry",
          resourceId: full.id,
          summary: `Created entry ${full.slug}`,
          meta: { contentTypeApiId: ct.apiId },
        });
        return {
          name,
          ok: true,
          summary: `Created entry ${slug} (${status}, ${locale})`,
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
        await auditMutation({
          action: "entry.update",
          resourceType: "entry",
          resourceId: full.id,
          summary: `Updated entry ${full.slug}`,
          meta: { contentTypeApiId: ct.apiId, fieldApiId },
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
        await auditMutation({
          action: "entry.update",
          resourceType: "entry",
          resourceId: full.id,
          summary: `Updated entry ${full.slug}`,
          meta: { contentTypeApiId: ct.apiId, fieldApiId },
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
        let status = str(rawArgs, "status") as EntryStatus | undefined;
        if (draftOnly && status === EntryStatus.published) {
          status = EntryStatus.draft;
        }
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
        await auditMutation({
          action: "entry.update",
          resourceType: "entry",
          resourceId: full.id,
          summary: `Updated entry ${full.slug}`,
          meta: { contentTypeApiId: ct.apiId },
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
        await auditMutation({
          action: publish ? "entry.publish" : "entry.unpublish",
          resourceType: "entry",
          resourceId: full.id,
          summary: `${publish ? "Published" : "Unpublished"} entry ${full.slug}`,
          meta: { contentTypeApiId: ct.apiId },
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
        await auditMutation({
          action: "entry.delete",
          resourceType: "entry",
          resourceId: existing.id,
          summary: `Deleted entry ${existing.slug}`,
          meta: { contentTypeApiId: ct.apiId },
        });
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
      case "fetch_url": {
        const url = str(rawArgs, "url");
        if (!url) throw new Error("url required");
        const maxChars = num(rawArgs, "maxChars");
        try {
          const data = await fetchPublicUrl(url, { maxChars });
          let host = url;
          try {
            host = new URL(data.finalUrl).host;
          } catch {
            /* keep url */
          }
          return {
            name,
            ok: true,
            summary: `Fetched ${host} (${data.links.length} links${data.truncated ? ", truncated" : ""})`,
            data,
          };
        } catch (error) {
          if (error instanceof WebFetchError) {
            return { name, ok: false, summary: error.message };
          }
          throw error;
        }
      }
      case "list_scheduled_tasks": {
        const items = await prisma.scheduledTask.findMany({
          where: { websiteId },
          orderBy: [{ nextRunAt: "asc" }, { createdAt: "desc" }],
          select: {
            id: true,
            name: true,
            enabled: true,
            frequency: true,
            timeOfDay: true,
            timeZone: true,
            nextRunAt: true,
            lastRunAt: true,
            lastStatus: true,
            allowPublish: true,
            prompt: true,
          },
        });
        const data = items.map((t) => ({
          id: t.id,
          name: t.name,
          enabled: t.enabled,
          frequency: t.frequency,
          timeOfDay: t.timeOfDay,
          timeZone: t.timeZone,
          nextRunAt: t.nextRunAt?.toISOString() ?? null,
          lastRunAt: t.lastRunAt?.toISOString() ?? null,
          lastStatus: t.lastStatus,
          allowPublish: t.allowPublish,
          promptPreview:
            t.prompt.length > 160 ? `${t.prompt.slice(0, 159)}…` : t.prompt,
        }));
        return {
          name,
          ok: true,
          summary: `Listed ${data.length} scheduled task(s)`,
          data,
        };
      }
      case "get_scheduled_task": {
        const id = str(rawArgs, "id");
        const taskName = str(rawArgs, "name");
        if (!id && !taskName) {
          throw new Error("id or name required");
        }
        const runLimit = Math.min(
          Math.max(1, Math.floor(num(rawArgs, "runLimit") ?? 10)),
          20,
        );
        const task = await prisma.scheduledTask.findFirst({
          where: {
            websiteId,
            ...(id ? { id } : { name: taskName }),
          },
          include: {
            runs: { orderBy: { startedAt: "desc" }, take: runLimit },
          },
        });
        if (!task) {
          return {
            name,
            ok: false,
            summary: id
              ? `Scheduled task "${id}" not found`
              : `Scheduled task named "${taskName}" not found`,
          };
        }
        const data = serializeScheduledTask(task, task.runs);
        return {
          name,
          ok: true,
          summary: `Loaded task "${task.name}" (${task.runs.length} recent run(s))`,
          data,
        };
      }
      case "list_scheduled_task_runs": {
        const taskId = str(rawArgs, "taskId");
        const taskName = str(rawArgs, "taskName");
        if (!taskId && !taskName) {
          throw new Error("taskId or taskName required");
        }
        const limit = Math.min(
          Math.max(1, Math.floor(num(rawArgs, "limit") ?? 5)),
          20,
        );
        const task = await prisma.scheduledTask.findFirst({
          where: {
            websiteId,
            ...(taskId ? { id: taskId } : { name: taskName }),
          },
          select: { id: true, name: true },
        });
        if (!task) {
          return {
            name,
            ok: false,
            summary: taskId
              ? `Scheduled task "${taskId}" not found`
              : `Scheduled task named "${taskName}" not found`,
          };
        }
        const runs = await prisma.scheduledTaskRun.findMany({
          where: { taskId: task.id },
          orderBy: { startedAt: "desc" },
          take: limit,
        });
        return {
          name,
          ok: true,
          summary: `Listed ${runs.length} run(s) for "${task.name}"`,
          data: {
            taskId: task.id,
            taskName: task.name,
            runs: runs.map(serializeScheduledTaskRun),
          },
        };
      }
      case "get_current_datetime": {
        const data = getCurrentDateTime();
        return {
          name,
          ok: true,
          summary: `Now ${data.localDisplay} (${data.timeZone})`,
          data,
        };
      }
      case "list_entry_versions": {
        const apiId = str(rawArgs, "apiId");
        const entryId = str(rawArgs, "entryId");
        if (!apiId || !entryId) throw new Error("apiId and entryId required");
        const ct = await getContentTypeOrThrow(apiId, websiteId);
        const existing = await prisma.entry.findFirst({
          where: { id: entryId, contentTypeId: ct.id },
        });
        if (!existing) {
          return { name, ok: false, summary: `Entry "${entryId}" not found` };
        }
        const versions = await listEntryVersions(existing.id, {
          limit: num(rawArgs, "limit"),
          offset: num(rawArgs, "offset"),
        });
        const data = versions.map(compactVersionMeta);
        return {
          name,
          ok: true,
          summary: `Listed ${data.length} version(s) for entry ${existing.slug}`,
          data,
        };
      }
      case "list_content_type_versions": {
        const apiId = str(rawArgs, "apiId");
        if (!apiId) throw new Error("apiId required");
        const ct = await getContentTypeOrThrow(apiId, websiteId);
        const versions = await listContentTypeVersions(ct.id, {
          limit: num(rawArgs, "limit"),
          offset: num(rawArgs, "offset"),
        });
        const data = versions.map(compactVersionMeta);
        return {
          name,
          ok: true,
          summary: `Listed ${data.length} schema version(s) for ${apiId}`,
          data,
        };
      }
      case "diff_versions": {
        const kind = str(rawArgs, "kind");
        const apiId = str(rawArgs, "apiId");
        const fromVersionId = str(rawArgs, "fromVersionId");
        const toVersionId = str(rawArgs, "toVersionId");
        if (!kind || !apiId || !fromVersionId || !toVersionId) {
          throw new Error(
            "kind, apiId, fromVersionId, and toVersionId required",
          );
        }
        if (kind !== "entry" && kind !== "content_type") {
          throw new Error('kind must be "entry" or "content_type"');
        }
        if (
          kind === "content_type" &&
          !roleAtLeast(role, RolePermission.schema)
        ) {
          return {
            name,
            ok: false,
            summary:
              'Permission denied: content_type diffs require builder or admin role',
          };
        }
        const ct = await getContentTypeOrThrow(apiId, websiteId);

        if (kind === "entry") {
          const entryId = str(rawArgs, "entryId");
          if (!entryId) throw new Error("entryId required when kind is entry");
          const existing = await prisma.entry.findFirst({
            where: { id: entryId, contentTypeId: ct.id },
          });
          if (!existing) {
            return { name, ok: false, summary: `Entry "${entryId}" not found` };
          }
          const [from, to] = await Promise.all([
            prisma.entryVersion.findFirst({
              where: { id: fromVersionId, entryId: existing.id },
            }),
            prisma.entryVersion.findFirst({
              where: { id: toVersionId, entryId: existing.id },
            }),
          ]);
          if (!from || !to) {
            return { name, ok: false, summary: "Version not found" };
          }
          const changes = diffEntrySnapshots(
            from.snapshot as {
              slug?: string;
              status?: string;
              locale?: string;
              fields?: Record<string, unknown>;
            },
            to.snapshot as {
              slug?: string;
              status?: string;
              locale?: string;
              fields?: Record<string, unknown>;
            },
          );
          return {
            name,
            ok: true,
            summary: `Diff entry versions: ${changes.length} change(s)`,
            data: { kind, from: from.id, to: to.id, changes },
          };
        }

        const [from, to] = await Promise.all([
          prisma.contentTypeVersion.findFirst({
            where: { id: fromVersionId, contentTypeId: ct.id },
          }),
          prisma.contentTypeVersion.findFirst({
            where: { id: toVersionId, contentTypeId: ct.id },
          }),
        ]);
        if (!from || !to) {
          return { name, ok: false, summary: "Version not found" };
        }
        const changes = diffContentTypeSnapshots(
          from.snapshot as {
            apiId?: string;
            name?: string;
            description?: string | null;
            localizationMode?: string;
            fields?: Array<{
              apiId: string;
              name?: string;
              type?: string;
              required?: boolean;
              sortOrder?: number;
              settings?: unknown;
            }>;
          },
          to.snapshot as {
            apiId?: string;
            name?: string;
            description?: string | null;
            localizationMode?: string;
            fields?: Array<{
              apiId: string;
              name?: string;
              type?: string;
              required?: boolean;
              sortOrder?: number;
              settings?: unknown;
            }>;
          },
        );
        return {
          name,
          ok: true,
          summary: `Diff schema versions: ${changes.length} change(s)`,
          data: { kind, from: from.id, to: to.id, changes },
        };
      }
      case "list_audit_events": {
        const events = await listAuditEvents({
          websiteId,
          resourceType: str(rawArgs, "resourceType"),
          resourceId: str(rawArgs, "resourceId"),
          limit: num(rawArgs, "limit"),
          offset: num(rawArgs, "offset"),
        });
        const data = events.map((e) => ({
          id: e.id,
          actorUserId: e.actorUserId,
          actorKind: e.actorKind,
          action: e.action,
          resourceType: e.resourceType,
          resourceId: e.resourceId,
          summary: e.summary,
          createdAt: e.createdAt,
        }));
        return {
          name,
          ok: true,
          summary: `Listed ${data.length} audit event(s)`,
          data,
        };
      }
      default:
        return {
          name,
          ok: false,
          summary: `Unknown tool: ${name}`,
        };
    }  } catch (error) {
    const apiCode =
      error && typeof error === "object" && "apiCode" in error
        ? (error as { apiCode?: string }).apiCode
        : undefined;
    let summary = error instanceof Error ? error.message : "Tool failed";
    if (apiCode === "CONTENT_TYPE_NOT_FOUND" && ENTRY_CONTENT_TOOLS.has(name)) {
      const available = await prisma.contentType.findMany({
        where: { websiteId },
        select: { apiId: true },
        orderBy: { apiId: "asc" },
        take: 20,
      });
      summary = available.length
        ? `${summary}. Available content types on this website: ${available
            .map((c) => c.apiId)
            .join(", ")}. Use one of these apiIds, or use the schema tools (create_content_type / create_field) to change the content model.`
        : `${summary}. This website has no content types yet. Use create_content_type to add one before creating entries.`;
    }
    return {
      name,
      ok: false,
      summary,
    };
  }
}
