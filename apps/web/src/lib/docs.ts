import type { FlatEntry } from "@cms/shared";
import { fieldNumber, fieldString, getEntry, listType } from "@/lib/cms";

export type DocMeta = {
  slug: string;
  title: string;
  description: string;
  order: number;
  /** Slug of parent `doc` entry; null/empty = top-level (shown in docs menu). */
  parentSlug: string | null;
};

export type DocPage = DocMeta & {
  body: string;
};

function relationSlug(entry: FlatEntry, key: string): string | null {
  const value = entry.fields[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function toMeta(entry: FlatEntry): DocMeta {
  return {
    slug: fieldString(entry, "slug", entry.slug) || entry.slug,
    title: fieldString(entry, "title", entry.slug),
    description: fieldString(entry, "description"),
    order: fieldNumber(entry, "sortOrder", 0),
    parentSlug: relationSlug(entry, "parent"),
  };
}

/** Published documentation entries from CMS content type `doc`. */
export async function listDocs(): Promise<DocMeta[]> {
  const entries = await listType("doc", 100);
  return entries.map((entry) => toMeta(entry));
}

/** Top-level docs (no parent) appear in the documentation menu. */
export function isDocNavVisible(doc: DocMeta): boolean {
  return !doc.parentSlug;
}

export function listNavDocs(catalog: DocMeta[]): DocMeta[] {
  return [...catalog]
    .filter(isDocNavVisible)
    .sort((a, b) => a.order - b.order);
}

export function docsBySlug(catalog: DocMeta[]): Map<string, DocMeta> {
  return new Map(catalog.map((doc) => [doc.slug, doc]));
}

/** Walk parent links to the top-level ancestor (for menu active state). */
export function rootNavSlug(
  doc: DocMeta,
  bySlug: Map<string, DocMeta>,
): string {
  let current = doc;
  const seen = new Set<string>();
  while (current.parentSlug) {
    if (seen.has(current.slug)) break;
    seen.add(current.slug);
    const parent = bySlug.get(current.parentSlug);
    if (!parent) break;
    current = parent;
  }
  return current.slug;
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
