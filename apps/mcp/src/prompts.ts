import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { requireActiveWebsite, type McpContext } from "./client.js";

export function registerPrompts(server: McpServer, ctx: McpContext) {
  server.prompt(
    "site_builder",
    "Workflow for provisioning schema + content on the authenticated Aurora website.",
    {
      goal: z
        .string()
        .optional()
        .describe("What the agent should build (types, pages, nav, etc.)"),
    },
    async ({ goal }) => {
      const website = requireActiveWebsite(ctx);
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `You are building content on Aurora website "${website.name}" (${website.id}).`,
                "Auth is already configured via MCP (user PAT or website token). Do not ask for passwords.",
                "1. Call whoami to confirm the tenant and role.",
                "2. If no website is active, list_websites then select_website.",
                "3. list_content_types to discover existing schema — do not invent field apiIds.",
                "4. Prefer provision for bulk idempotent upserts; otherwise create_content_type / create_field / create_entry.",
                "5. Publish with publish_entry when content should appear on the public site.",
                "6. After schema changes, use the frontend_brief prompt for frontend agents.",
                goal ? `\nGoal: ${goal}` : "",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  server.prompt(
    "frontend_brief",
    "Generate instructions for a frontend agent after CMS schema changes.",
    {
      changedSummary: z
        .string()
        .optional()
        .describe("What changed (types/fields created or updated)"),
    },
    async ({ changedSummary }) => {
      const website = requireActiveWebsite(ctx);
      const types = await ctx.client.listAdminContentTypes();
      const model = types.map((t) => {
        const fields = (t.fields ?? [])
          .map(
            (f) =>
              `- \`${f.apiId}\` (${f.type}${f.required ? ", required" : ""}) — ${f.name}` +
              (f.settings?.contentFormat
                ? ` [contentFormat=${f.settings.contentFormat}]`
                : ""),
          )
          .join("\n");
        return `### Type \`${t.apiId}\` (${t.name})\n${t.description ?? ""}\n${fields}`;
      });

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                "## Frontend agent brief (copy-paste)",
                "",
                "Paste this into your frontend coding agent. Update the website to match the Aurora CMS schema.",
                "",
                "### What changed",
                changedSummary?.trim() || "(summarize recent tool mutations)",
                "",
                "### Current content model (source of truth)",
                ...model,
                "",
                "### How to implement",
                "1. Discover schema with GET /api/v1/content-types and header x-site-key (do not invent field apiIds).",
                "2. Render only from entry.fields.<fieldApiId> — never top-level entry.title etc.",
                "3. Use only published entries on the public API; drafts are invisible.",
                "4. richtext values are HTML (see contentFormat on fields). Prefer media objects `{ url, alt }` (legacy URL strings still work).",
                "5. Follow docs/frontend-playbook.md when present.",
                "",
                "### Do not",
                "- Hard-code field names missing from the schema",
                "- Commit or expose management tokens (aur_… / aur_u_…) in the browser",
                "",
                `Site key for this website: ${website.siteKey}`,
                `API: ${ctx.apiUrl}`,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  server.prompt(
    "content_editor",
    "Safe content editing: prefer str_replace_field, then publish checklist.",
    {
      contentTypeApiId: z.string().describe("Content type apiId"),
      entrySlugOrId: z.string().describe("Entry slug or id hint"),
    },
    async ({ contentTypeApiId, entrySlugOrId }) => {
      const website = requireActiveWebsite(ctx);
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `Edit content on website "${website.name}".`,
                `Content type: ${contentTypeApiId}. Target: ${entrySlugOrId}.`,
                "1. list_entries / get_entry to load current fields.",
                "2. Prefer str_replace_field for precise edits; write_field only for full rewrites.",
                "3. Do not invent field apiIds — use get_content_type.",
                "4. After edits, publish_entry if the change should be public.",
                "5. Verify with get_published_entry when public read is enabled.",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}
