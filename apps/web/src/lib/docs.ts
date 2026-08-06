import type { FlatEntry } from "@cms/shared";
import { fieldNumber, fieldString, getEntry, listType } from "@/lib/cms";

export type DocMeta = {
  slug: string;
  title: string;
  description: string;
  order: number;
  /** Nav section label; empty = top-level / ungrouped */
  chapter: string;
};

export type DocPage = DocMeta & {
  body: string;
};

export type DocChapterGroup = {
  chapter: string;
  docs: DocMeta[];
};

function toMeta(entry: FlatEntry): DocMeta {
  return {
    slug: fieldString(entry, "slug", entry.slug) || entry.slug,
    title: fieldString(entry, "title", entry.slug),
    description: fieldString(entry, "description"),
    order: fieldNumber(entry, "sortOrder", 0),
    chapter: fieldString(entry, "chapter").trim(),
  };
}

/** Published documentation entries from CMS content type `doc`. */
export async function listDocs(): Promise<DocMeta[]> {
  const entries = await listType("doc", 100);
  return entries.map((entry) => toMeta(entry));
}

/** Integration detail pages — linked from /docs/integrations, not the sidebar. */
const DOCS_NAV_HIDDEN_SLUGS = new Set([
  "public-api",
  "management-api",
  "admin-api",
  "mcp",
]);

/**
 * Sidebar visibility: hide Public API, Management API, Admin API, and MCP.
 * They remain reachable via /docs/integrations and direct URLs.
 */
export function isDocNavVisible(doc: DocMeta): boolean {
  if (DOCS_NAV_HIDDEN_SLUGS.has(doc.slug)) return false;
  if (doc.chapter === "Integrations" && doc.slug !== "integrations") {
    return false;
  }
  return true;
}

/** Docs shown in the sidebar (chapter landings + ungrouped pages). */
export function listNavDocs(catalog: DocMeta[]): DocMeta[] {
  return [...catalog]
    .filter(isDocNavVisible)
    .sort((a, b) => a.order - b.order);
}

/** Group docs by chapter while preserving global sortOrder. */
export function groupDocsByChapter(catalog: DocMeta[]): DocChapterGroup[] {
  const sorted = listNavDocs(catalog);
  const groups: DocChapterGroup[] = [];
  for (const doc of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.chapter === doc.chapter) {
      last.docs.push(doc);
    } else {
      groups.push({ chapter: doc.chapter, docs: [doc] });
    }
  }
  return groups;
}

export async function getDocMeta(slug: string): Promise<DocMeta | null> {
  const entry = await getEntry("doc", slug);
  return entry ? toMeta(entry) : null;
}

export async function getDoc(slug: string): Promise<DocPage | null> {
  const entry = await getEntry("doc", slug);
  if (!entry) return null;
  const meta = toMeta(entry);
  const body = fieldString(entry, "body");
  if (!body.trim()) return null;
  return { ...meta, body };
}
