import type { AiChatContext } from "@cms/shared";
import { prisma } from "../db.js";
import { entryInclude } from "../lib/entries.js";
import { serializeEntry } from "../lib/serialize.js";
import {
  resolveIndexPerType,
  resolveKnowledgeMaxChars,
} from "./contextBudget.js";

const TITLE_KEYS = ["title", "label", "name", "siteName", "heading"];
const FIELD_VALUE_MAX = 280;
const FOCUS_VALUE_MAX = 2_500;

function truncate(value: string, max: number): string {
  const t = value.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function plainFromUnknown(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function titleFromFields(fields: Record<string, unknown>): string | null {
  for (const key of TITLE_KEYS) {
    const v = fields[key];
    if (typeof v === "string" && v.trim()) return truncate(v.trim(), 80);
  }
  return null;
}

function compactFields(
  fields: Record<string, unknown>,
  maxPerField: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(fields)) {
    const text = plainFromUnknown(raw);
    if (!text) continue;
    out[key] = truncate(text, maxPerField);
  }
  return out;
}

/**
 * Compact, always-on website knowledge for the AI system prompt.
 * Schema + chrome + entry index; deep body only for the focused entry.
 */
export async function buildWebsiteKnowledge(
  websiteId: string,
  focus?: AiChatContext,
): Promise<string> {
  const focused = Boolean(focus?.entryId);
  const maxChars = resolveKnowledgeMaxChars(focused);
  const indexPerType = resolveIndexPerType(focused);

  const website = await prisma.website.findUnique({
    where: { id: websiteId },
    select: {
      id: true,
      name: true,
      siteKey: true,
      locales: true,
      defaultLocale: true,
    },
  });
  if (!website) return "Website knowledge: (website not found)";

  const [types, forms] = await Promise.all([
    prisma.contentType.findMany({
      where: { websiteId },
      include: {
        fields: { orderBy: { sortOrder: "asc" } },
        entries: {
          orderBy: { updatedAt: "desc" },
          take: indexPerType,
          include: {
            fieldValues: { include: { field: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.form.findMany({
      where: { websiteId },
      include: { fields: { orderBy: { sortOrder: "asc" } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const sections: string[] = [];
  sections.push(`## Website
- name: ${website.name}
- siteKey: ${website.siteKey}
- websiteId: ${website.id}
- defaultLocale: ${website.defaultLocale}
- locales: ${website.locales.join(", ") || "(none)"}
- locale rule: always create/edit in defaultLocale (${website.defaultLocale}) unless the user explicitly asks for another enabled locale from this list`);

  // Schema
  const schemaLines = types.map((ct) => {
    const fieldBits = ct.fields
      .map(
        (f) =>
          `${f.apiId}:${f.type}${f.required ? "*" : ""}`,
      )
      .join(", ");
    return `- ${ct.apiId} (${ct.name}): ${fieldBits || "(no fields)"}`;
  });
  sections.push(
    `## Content types (schema)\n${schemaLines.join("\n") || "- (none yet)"}`,
  );

  // site_settings chrome
  const settingsType = types.find((t) => t.apiId === "site_settings");
  const settingsEntry =
    settingsType?.entries.find((e) => e.slug === "default") ??
    settingsType?.entries[0];
  if (settingsEntry && settingsType) {
    const fields: Record<string, unknown> = {};
    for (const fv of settingsEntry.fieldValues) {
      fields[fv.field.apiId] = fv.value;
    }
    const compact = compactFields(fields, FIELD_VALUE_MAX);
    sections.push(
      `## Site settings (slug \`${settingsEntry.slug}\`, ${settingsEntry.status})\n\`\`\`json\n${JSON.stringify(compact, null, 2)}\n\`\`\``,
    );
  }

  // Navigation
  const navType = types.find((t) => t.apiId === "nav_item");
  if (navType?.entries.length) {
    const navRows = navType.entries
      .map((e) => {
        const fields: Record<string, unknown> = {};
        for (const fv of e.fieldValues) fields[fv.field.apiId] = fv.value;
        const label =
          typeof fields.label === "string" ? fields.label : e.slug;
        const href =
          typeof fields.href === "string" ? fields.href : "";
        const sort =
          typeof fields.sortOrder === "number" ? fields.sortOrder : 0;
        return { sort, line: `- [${e.status}] ${label} → ${href} (slug \`${e.slug}\`, id ${e.id})` };
      })
      .sort((a, b) => a.sort - b.sort)
      .map((r) => r.line);
    sections.push(`## Navigation\n${navRows.join("\n")}`);
  }

  // Entry index per type (skip dumping full site_settings / nav again as bodies)
  const indexBlocks: string[] = [];
  for (const ct of types) {
    if (!ct.entries.length) {
      indexBlocks.push(`### ${ct.apiId}\n- (no entries)`);
      continue;
    }
    const lines = ct.entries.map((e) => {
      const fields: Record<string, unknown> = {};
      for (const fv of e.fieldValues) fields[fv.field.apiId] = fv.value;
      const title = titleFromFields(fields);
      const label = title ? `"${title}"` : "";
      return `- ${e.status} \`${e.slug}\` locale=${e.locale} id=${e.id}${label ? ` ${label}` : ""}`;
    });
    const more =
      ct.entries.length >= indexPerType
        ? `\n- …(showing latest ${indexPerType})`
        : "";
    indexBlocks.push(`### ${ct.apiId}\n${lines.join("\n")}${more}`);
  }
  sections.push(`## Entry index\n${indexBlocks.join("\n\n")}`);

  if (forms.length) {
    const formLines = forms.map((f) => {
      const fields = f.fields
        .map((ff) => `${ff.apiId}:${ff.type}`)
        .join(", ");
      return `- ${f.apiId} (${f.name}${f.enabled ? "" : ", disabled"}): ${fields || "(no fields)"}`;
    });
    sections.push(`## Forms\n${formLines.join("\n")}`);
  }

  // Focused entry deep context
  if (focus?.entryId) {
    const full = await prisma.entry.findFirst({
      where: {
        id: focus.entryId,
        contentType: { websiteId },
      },
      include: entryInclude,
    });
    if (full) {
      const flat = serializeEntry(full);
      const compact = compactFields(flat.fields, FOCUS_VALUE_MAX);
      sections.push(
        `## Focused entry (current screen)
- contentType: ${flat.contentType}
- slug: ${flat.slug}
- locale: ${flat.locale}
- status: ${flat.status}
- id: ${flat.id}
\`\`\`json
${JSON.stringify(compact, null, 2)}
\`\`\``,
      );
    }
  } else if (focus?.contentTypeApiId) {
    const ct = types.find((t) => t.apiId === focus.contentTypeApiId);
    if (ct) {
      sections.push(
        `## Focused content type
- apiId: ${ct.apiId}
- name: ${ct.name}
- description: ${ct.description ?? "(none)"}
- fields: ${ct.fields.map((f) => `${f.apiId}:${f.type}`).join(", ")}`,
      );
    }
  }

  if (focus?.formApiId) {
    const form = forms.find((f) => f.apiId === focus.formApiId);
    if (form) {
      sections.push(
        `## Focused form
- apiId: ${form.apiId}
- name: ${form.name}
- fields: ${form.fields.map((f) => `${f.apiId}:${f.type}`).join(", ")}`,
      );
    }
  }

  sections.push(`## Voice & consistency rules
- Match the brand/voice from site settings and existing published pages — do not invent a different brand name or tone.
- Reuse existing slugs/types when updating; check the entry index before creating duplicates.
- Prefer the field apiIds from the schema above; call get_content_type only if something is missing.
- When writing page/post copy, mirror length and HTML structure of similar existing entries.
- Never create entries in a locale that is not listed under Website locales (especially do not default to en-US unless it is the site defaultLocale).`);

  let text = sections.join("\n\n");
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars - 1)}…\n\n(Website knowledge truncated for length.)`;
  }
  return text;
}
