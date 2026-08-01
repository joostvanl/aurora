import type { ToolResult } from "./tools.js";
import { FRONTEND_BRIEF_HEADING } from "./frontendBrief.js";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export type StudioEntryLink = {
  id: string;
  slug: string;
  contentType: string;
  status?: string;
};

export type StudioTypeLink = {
  apiId: string;
  name?: string;
};

export type StudioFormLink = {
  apiId: string;
  name?: string;
};

function entryFromData(data: unknown): StudioEntryLink | null {
  const d = asRecord(data);
  const id = typeof d.id === "string" ? d.id : null;
  const slug = typeof d.slug === "string" ? d.slug : null;
  const contentType =
    typeof d.contentType === "string" ? d.contentType : null;
  if (!id || !slug || !contentType) return null;
  return {
    id,
    slug,
    contentType,
    status: typeof d.status === "string" ? d.status : undefined,
  };
}

function typeFromData(data: unknown): StudioTypeLink | null {
  const d = asRecord(data);
  const apiId = typeof d.apiId === "string" ? d.apiId : null;
  if (!apiId) return null;
  // Field payloads also have apiId — only treat as type when fields array present or name+no type enum
  if (Array.isArray(d.fields) || typeof d.description === "string" || d.name) {
    // Heuristic: content types have fields array; field defs have `type` as FieldType string and contentTypeId
    if (typeof d.type === "string" && !Array.isArray(d.fields)) {
      return null;
    }
    return {
      apiId,
      name: typeof d.name === "string" ? d.name : undefined,
    };
  }
  return null;
}

function formFromData(data: unknown): StudioFormLink | null {
  const d = asRecord(data);
  const apiId = typeof d.apiId === "string" ? d.apiId : null;
  if (!apiId) return null;
  if (Array.isArray(d.fields) && typeof d.submitLabel === "string") {
    return {
      apiId,
      name: typeof d.name === "string" ? d.name : undefined,
    };
  }
  if (typeof d.submitLabel === "string" || typeof d.successMessage === "string") {
    return {
      apiId,
      name: typeof d.name === "string" ? d.name : undefined,
    };
  }
  return null;
}

const ENTRY_TOOLS = new Set([
  "create_entry",
  "get_entry",
  "str_replace",
  "write_field",
  "update_entry_meta",
  "publish_entry",
  "unpublish_entry",
]);

const TYPE_TOOLS = new Set([
  "create_content_type",
  "update_content_type",
  "get_content_type",
  "create_field",
  "update_field",
  "delete_field",
]);

const FORM_TOOLS = new Set([
  "create_form",
  "update_form",
  "get_form",
  "create_form_field",
  "update_form_field",
]);

export function collectStudioLinks(toolCalls: ToolResult[]): {
  entries: StudioEntryLink[];
  types: StudioTypeLink[];
  forms: StudioFormLink[];
} {
  const entries = new Map<string, StudioEntryLink>();
  const types = new Map<string, StudioTypeLink>();
  const forms = new Map<string, StudioFormLink>();

  for (const call of toolCalls) {
    if (!call.ok) continue;
    if (ENTRY_TOOLS.has(call.name)) {
      const entry = entryFromData(call.data);
      if (entry) entries.set(entry.id, entry);
    }
    if (TYPE_TOOLS.has(call.name)) {
      const type = typeFromData(call.data);
      if (type) types.set(type.apiId, type);
      // create_field returns full content type
      const d = asRecord(call.data);
      if (typeof d.apiId === "string" && Array.isArray(d.fields)) {
        types.set(d.apiId, {
          apiId: d.apiId,
          name: typeof d.name === "string" ? d.name : undefined,
        });
      }
    }
    if (FORM_TOOLS.has(call.name)) {
      const form = formFromData(call.data);
      if (form) forms.set(form.apiId, form);
      const d = asRecord(call.data);
      if (typeof d.apiId === "string" && Array.isArray(d.fields)) {
        forms.set(d.apiId, {
          apiId: d.apiId,
          name: typeof d.name === "string" ? d.name : undefined,
        });
      }
    }
  }

  return {
    entries: [...entries.values()],
    types: [...types.values()],
    forms: [...forms.values()],
  };
}

function entryHref(e: StudioEntryLink) {
  return `/entries/${e.contentType}/${e.id}`;
}

function typeHref(t: StudioTypeLink) {
  return `/content-types/${t.apiId}`;
}

function formHref(f: StudioFormLink) {
  return `/forms/${f.apiId}`;
}

/**
 * Ensure CMS entities from tool results are linked as studio markdown links.
 * Inserts / updates an "Open in studio" section before any frontend brief.
 */
export function ensureStudioMarkdownLinks(
  reply: string,
  toolCalls: ToolResult[],
): string {
  const { entries, types, forms } = collectStudioLinks(toolCalls);
  if (!entries.length && !types.length && !forms.length) return reply;

  let next = reply;

  // Prefer inline links for bare `slug` mentions when unique enough
  for (const entry of entries) {
    const href = entryHref(entry);
    const md = `[${entry.slug}](${href})`;
    if (next.includes(href)) continue;
    const tick = `\`${entry.slug}\``;
    if (next.includes(tick)) {
      next = next.split(tick).join(md);
      continue;
    }
  }

  for (const type of types) {
    const href = typeHref(type);
    if (next.includes(href)) continue;
    const tick = `\`${type.apiId}\``;
    if (next.includes(tick)) {
      next = next.split(tick).join(`[${type.name ?? type.apiId}](${href})`);
    }
  }

  for (const form of forms) {
    const href = formHref(form);
    if (next.includes(href)) continue;
    const tick = `\`${form.apiId}\``;
    if (next.includes(tick)) {
      next = next.split(tick).join(`[${form.name ?? form.apiId}](${href})`);
    }
  }

  const lines: string[] = [];
  for (const entry of entries) {
    const href = entryHref(entry);
    const status = entry.status ? ` (${entry.status})` : "";
    lines.push(
      `- Entry [${entry.slug}](${href})${status} · \`${entry.contentType}\``,
    );
  }
  for (const type of types) {
    lines.push(
      `- Content type [${type.name ?? type.apiId}](${typeHref(type)})`,
    );
  }
  for (const form of forms) {
    lines.push(`- Form [${form.name ?? form.apiId}](${formHref(form)})`);
  }

  if (!lines.length) return next;

  const section = `### Open in studio\n${lines.join("\n")}`;
  const sectionHeading = "### Open in studio";

  // Drop a previous auto section to avoid duplicates on retries
  if (next.includes(sectionHeading)) {
    const briefIdx = next.indexOf(FRONTEND_BRIEF_HEADING);
    const start = next.indexOf(sectionHeading);
    const end = briefIdx > start ? briefIdx : next.length;
    next = `${next.slice(0, start).trimEnd()}\n\n${next.slice(end).trimStart()}`.trim();
  }

  if (next.includes(FRONTEND_BRIEF_HEADING)) {
    return next.replace(
      FRONTEND_BRIEF_HEADING,
      `${section}\n\n${FRONTEND_BRIEF_HEADING}`,
    );
  }

  // Still missing individual hrefs? Section covers them.
  return `${next.trim()}\n\n${section}`;
}
