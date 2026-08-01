import { prisma } from "../db.js";
import { serializeContentType } from "../lib/serialize.js";
import type { ToolResult } from "./tools.js";
import { CONTENT_SCHEMA_TOOLS } from "./tools.js";

export const FRONTEND_BRIEF_HEADING =
  "## Frontend agent brief (copy-paste)";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function collectAffectedTypeApiIds(toolCalls: ToolResult[]): string[] {
  const ids = new Set<string>();
  for (const call of toolCalls) {
    if (!call.ok || !CONTENT_SCHEMA_TOOLS.has(call.name)) continue;
    const data = asRecord(call.data);
    if (typeof data.apiId === "string") ids.add(data.apiId);
    if (typeof data.contentTypeApiId === "string")
      ids.add(data.contentTypeApiId);
    // create_field / update_field often nest under content type serialize
    const nested = asRecord(data.contentType);
    if (typeof nested.apiId === "string") ids.add(nested.apiId);
  }
  return [...ids];
}

function fieldLine(f: {
  apiId: string;
  name: string;
  type: string;
  required: boolean;
}): string {
  const req = f.required ? ", required" : ", optional";
  if (f.type === "media") {
    return `- \`${f.apiId}\` (media${req}) — ${f.name}; value is a **public image URL string** (or empty). Use as \`<img src={entry.fields.${f.apiId}}>\`; treat missing/empty as no image.`;
  }
  if (f.type === "richtext") {
    return `- \`${f.apiId}\` (richtext${req}) — ${f.name}; HTML string (render as HTML, not Markdown)`;
  }
  return `- \`${f.apiId}\` (${f.type}${req}) — ${f.name}`;
}

/**
 * Practical copy-paste prompt for a frontend coding agent after CMS schema changes.
 */
export async function buildFrontendAgentBrief(
  websiteId: string,
  toolCalls: ToolResult[],
): Promise<string | null> {
  const schemaCalls = toolCalls.filter(
    (t) => t.ok && CONTENT_SCHEMA_TOOLS.has(t.name),
  );
  if (!schemaCalls.length) return null;

  const changeLines = schemaCalls.map(
    (t) => `- ${t.name}: ${t.summary}`,
  );

  let typeApiIds = collectAffectedTypeApiIds(schemaCalls);
  if (!typeApiIds.length) {
    // Fall back: list all types so the frontend agent still has a snapshot
    const all = await prisma.contentType.findMany({
      where: { websiteId },
      select: { apiId: true },
      orderBy: { name: "asc" },
    });
    typeApiIds = all.map((t) => t.apiId);
  }

  const types = await prisma.contentType.findMany({
    where: { websiteId, apiId: { in: typeApiIds } },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
    orderBy: { name: "asc" },
  });

  const modelBlocks = types.map((ct) => {
    const serialized = serializeContentType(ct);
    const fields = (serialized.fields ?? []).map(fieldLine).join("\n");
    return `### Type \`${serialized.apiId}\` (${serialized.name})
${serialized.description ? `${serialized.description}\n` : ""}${fields || "- (no fields yet)"}`;
  });

  const routeHints = types
    .map((ct) => {
      if (ct.apiId === "page") {
        return `- Pages: route by entry slug (e.g. \`/\`, \`/about\`) from \`page\` entries; read \`entry.fields.*\``;
      }
      if (ct.apiId === "post") {
        return `- Blog: list \`GET .../content-types/post/entries\`, detail \`.../post/entries/{slug}\``;
      }
      return `- \`${ct.apiId}\`: list \`GET /api/v1/content-types/${ct.apiId}/entries\`, detail \`.../${ct.apiId}/entries/{slug}\``;
    })
    .join("\n");

  return `${FRONTEND_BRIEF_HEADING}

Paste this into your frontend coding agent. It should update the website to match the new Aurora CMS schema.

### What changed in the CMS
${changeLines.join("\n")}

### Current content model (source of truth)
${modelBlocks.join("\n\n") || "(affected types were deleted — remove related UI)"}

### How to implement
1. Discover schema with \`GET /api/v1/content-types\` and header \`x-site-key\` (do not invent field apiIds).
2. Render only from \`entry.fields.<fieldApiId>\` — never top-level \`entry.title\` etc.
3. Use only **published** entries on the public API; drafts are invisible.
4. Suggested fetch/routing:
${routeHints}
5. Follow the project’s existing patterns in \`docs/frontend-playbook.md\` when present.
6. After wiring, verify empty/missing fields gracefully (optional chaining / fallbacks).

### Do not
- Hard-code field names that are not in the schema above
- Assume Markdown for richtext — richtext values are HTML
- Treat \`media\` fields as objects — they are URL **strings** (empty if unset)
- Commit or expose management tokens in the browser

### Done when
- UI reads the new/changed fields correctly
- Routes and lists use the correct content type \`apiId\`s
- Unpublished content does not appear on the public site`;
}

export function replyHasFrontendBrief(reply: string): boolean {
  return reply.includes(FRONTEND_BRIEF_HEADING);
}

export function mergeFrontendBrief(reply: string, brief: string): string {
  if (replyHasFrontendBrief(reply)) return reply;
  return `${reply.trim()}\n\n${brief}`;
}
