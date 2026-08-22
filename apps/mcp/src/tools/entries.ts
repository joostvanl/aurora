import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { McpContext } from "../client.js";
import { toolError, toolOk } from "../errors.js";

export function registerEntryTools(server: McpServer, ctx: McpContext) {
  const { client } = ctx;

  server.tool(
    "list_entries",
    "List entries for a content type (includes drafts). Management API. Optional field+in filters entries by a content-type field value (equality/IN).",
    {
      apiId: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
      slug: z.string().optional(),
      status: z.enum(["draft", "published"]).optional(),
      sort: z
        .enum(["publishedAt", "createdAt", "updatedAt", "sortOrder"])
        .optional(),
      order: z.enum(["asc", "desc"]).optional(),
      field: z
        .string()
        .min(1)
        .optional()
        .describe("Field apiId to filter on (requires `in`)"),
      in: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe("Match value(s) for `field` — string or string array"),
    },
    async ({ apiId, ...params }) => {
      try {
        return toolOk(await client.listAdminEntries(apiId, params));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "get_entry",
    "Get one entry by id (management).",
    {
      apiId: z.string().min(1),
      entryId: z.string().min(1),
    },
    async ({ apiId, entryId }) => {
      try {
        return toolOk(await client.getAdminEntry(apiId, entryId));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "get_entry_field",
    "Read one string field in full (any content type). Returns value, length, sha256. Always re-read after a mutate before claiming success.",
    {
      apiId: z.string().min(1),
      entryId: z.string().min(1),
      fieldApiId: z.string().min(1),
    },
    async ({ apiId, entryId, fieldApiId }) => {
      try {
        return toolOk(
          await client.getAdminEntryField(apiId, entryId, fieldApiId),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "create_entry",
    "Create an entry. Values go in fields keyed by field apiId.",
    {
      apiId: z.string().min(1),
      slug: z.string().min(1),
      locale: z.string().optional(),
      status: z.enum(["draft", "published"]).optional(),
      fields: z.record(z.unknown()).optional(),
    },
    async ({ apiId, ...input }) => {
      try {
        return toolOk(await client.createEntry(apiId, input));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "update_entry",
    "Update entry slug/status/fields (partial).",
    {
      apiId: z.string().min(1),
      entryId: z.string().min(1),
      slug: z.string().min(1).optional(),
      locale: z.string().optional(),
      status: z.enum(["draft", "published"]).optional(),
      fields: z.record(z.unknown()).optional(),
      field_edits: z
        .record(
          z.string().min(1),
          z.array(
            z.object({
              old_string: z.string().min(1),
              new_string: z.string(),
              replace_all: z.boolean().optional(),
            }),
          ),
        )
        .optional(),
      json_edits: z
        .record(
          z.string().min(1),
          z.array(
            z.object({
              path: z.string(),
              match: z.record(z.unknown()),
              op: z.enum([
                "insert_after",
                "insert_before",
                "replace",
                "replace_object",
                "remove",
              ]),
              value: z.unknown().optional(),
            }),
          ),
        )
        .optional(),
      expected_field_hashes: z.record(z.string().min(1), z.string()).optional(),
    },
    async ({ apiId, entryId, ...input }) => {
      try {
        return toolOk(await client.updateEntry(apiId, entryId, input));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "delete_entry",
    "Delete an entry. Destructive.",
    {
      apiId: z.string().min(1),
      entryId: z.string().min(1),
    },
    async ({ apiId, entryId }) => {
      try {
        return toolOk(await client.deleteEntry(apiId, entryId));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "publish_entry",
    "Publish an entry (makes it visible on the public API).",
    {
      apiId: z.string().min(1),
      entryId: z.string().min(1),
    },
    async ({ apiId, entryId }) => {
      try {
        return toolOk(await client.publishEntry(apiId, entryId));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "unpublish_entry",
    "Unpublish an entry (hides it from the public API).",
    {
      apiId: z.string().min(1),
      entryId: z.string().min(1),
    },
    async ({ apiId, entryId }) => {
      try {
        return toolOk(await client.unpublishEntry(apiId, entryId));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "write_field",
    "Replace an entire field value on an entry.",
    {
      apiId: z.string().min(1),
      entryId: z.string().min(1),
      fieldApiId: z.string().min(1),
      value: z.unknown(),
      expected_field_hash: z.string().optional(),
    },
    async ({ apiId, entryId, fieldApiId, value, expected_field_hash }) => {
      try {
        return toolOk(
          await client.updateEntry(apiId, entryId, {
            fields: { [fieldApiId]: value },
            ...(expected_field_hash
              ? { expected_field_hashes: { [fieldApiId]: expected_field_hash } }
              : {}),
          }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "str_replace_field",
    "Cursor-style string replace inside a string field. Fails if oldString is missing or not unique when required.",
    {
      apiId: z.string().min(1),
      entryId: z.string().min(1),
      fieldApiId: z.string().min(1),
      oldString: z.string().min(1),
      newString: z.string(),
      replaceAll: z.boolean().optional(),
      expected_field_hash: z.string().optional(),
    },
    async ({
      apiId,
      entryId,
      fieldApiId,
      oldString,
      newString,
      replaceAll,
      expected_field_hash,
    }) => {
      try {
        const updated = await client.updateEntry(apiId, entryId, {
          field_edits: {
            [fieldApiId]: [
              {
                old_string: oldString,
                new_string: newString,
                replace_all: replaceAll,
              },
            ],
          },
          ...(expected_field_hash
            ? { expected_field_hashes: { [fieldApiId]: expected_field_hash } }
            : {}),
        });
        return toolOk({
          replaced: updated.fieldEditSummary?.applied ?? 1,
          entry: updated,
        });
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "patch_json_field",
    "Structurally edit a string field whose current value is JSON. path must point to an array of objects; match selects exactly one object. Prefer this over str_replace_field when the value is JSON.",
    {
      apiId: z.string().min(1),
      entryId: z.string().min(1),
      fieldApiId: z.string().min(1),
      path: z.string(),
      match: z.record(z.unknown()),
      op: z.enum([
        "insert_after",
        "insert_before",
        "replace",
        "replace_object",
        "remove",
      ]),
      value: z.unknown().optional(),
      expected_field_hash: z.string().optional(),
    },
    async ({
      apiId,
      entryId,
      fieldApiId,
      path,
      match,
      op,
      value,
      expected_field_hash,
    }) => {
      try {
        return toolOk(
          await client.updateEntry(apiId, entryId, {
            json_edits: {
              [fieldApiId]: [
                {
                  path,
                  match,
                  op,
                  ...(op === "remove" ? {} : { value }),
                },
              ],
            },
            ...(expected_field_hash
              ? { expected_field_hashes: { [fieldApiId]: expected_field_hash } }
              : {}),
          }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "create_preview_token",
    "Mint a short-lived preview token / URL for a draft entry (frontend preview).",
    {
      apiId: z.string().min(1),
      entryId: z.string().min(1),
    },
    async ({ apiId, entryId }) => {
      try {
        return toolOk(await client.createPreviewToken(apiId, entryId));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "verify_entry_password",
    "Management-only: check a plaintext password against a hashed password field on an entry. Never returns the hash. Wrong password → 401.",
    {
      apiId: z.string().min(1),
      entryId: z.string().min(1),
      password: z.string().min(1),
      fieldApiId: z.string().min(1).optional(),
    },
    async ({ apiId, entryId, password, fieldApiId }) => {
      try {
        return toolOk(
          await client.verifyEntryPassword(apiId, entryId, {
            password,
            ...(fieldApiId ? { fieldApiId } : {}),
          }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "verify_entry_credentials",
    "Management-only: look up an entry by slug and verify username + password fields (app login against CMS credentials).",
    {
      apiId: z.string().min(1),
      slug: z.string().min(1),
      username: z.string().min(1),
      password: z.string().min(1),
      locale: z.string().optional(),
      usernameFieldApiId: z.string().min(1).optional(),
      passwordFieldApiId: z.string().min(1).optional(),
    },
    async (args) => {
      try {
        const {
          apiId,
          slug,
          username,
          password,
          locale,
          usernameFieldApiId,
          passwordFieldApiId,
        } = args;
        return toolOk(
          await client.verifyEntryCredentials(apiId, {
            slug,
            username,
            password,
            ...(locale ? { locale } : {}),
            ...(usernameFieldApiId ? { usernameFieldApiId } : {}),
            ...(passwordFieldApiId ? { passwordFieldApiId } : {}),
          }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "provision",
    "Idempotent upsert of content types, fields, and entries in one call.",
    {
      contentTypes: z.array(
        z.object({
          apiId: z.string().min(1),
          name: z.string().min(1),
          description: z.string().optional(),
          fields: z
            .array(
              z.object({
                apiId: z.string().min(1),
                name: z.string().min(1),
                type: z.string().min(1),
                required: z.boolean().optional(),
                sortOrder: z.number().optional(),
                settings: z.record(z.unknown()).nullable().optional(),
              }),
            )
            .optional(),
          entries: z
            .array(
              z.object({
                slug: z.string().min(1),
                status: z.enum(["draft", "published"]).optional(),
                locale: z.string().optional(),
                fields: z.record(z.unknown()).optional(),
              }),
            )
            .optional(),
        }),
      ),
    },
    async (input) => {
      try {
        return toolOk(
          await client.provision(
            input as Parameters<typeof client.provision>[0],
          ),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "list_entry_versions",
    "List immutable entry versions (newest first). Management API.",
    {
      apiId: z.string().min(1),
      entryId: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    },
    async ({ apiId, entryId, limit, offset }) => {
      try {
        return toolOk(
          await client.listEntryVersions(apiId, entryId, { limit, offset }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "restore_entry_version",
    "Restore an entry to a prior version (checkpoints current state first).",
    {
      apiId: z.string().min(1),
      entryId: z.string().min(1),
      versionId: z.string().min(1),
    },
    async ({ apiId, entryId, versionId }) => {
      try {
        return toolOk(
          await client.restoreEntryVersion(apiId, entryId, versionId),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
