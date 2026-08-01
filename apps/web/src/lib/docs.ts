import type { FlatEntry } from "@cms/shared";
import { fieldNumber, fieldString, getEntry, listType } from "@/lib/cms";

export type DocMeta = {
  slug: string;
  title: string;
  description: string;
  order: number;
};

export type DocPage = DocMeta & {
  body: string;
};

function toMeta(entry: FlatEntry): DocMeta {
  return {
    slug: fieldString(entry, "slug", entry.slug) || entry.slug,
    title: fieldString(entry, "title", entry.slug),
    description: fieldString(entry, "description"),
    order: fieldNumber(entry, "sortOrder", 0),
  };
}

/** Published documentation entries from CMS content type `doc`. */
export async function listDocs(): Promise<DocMeta[]> {
  const entries = await listType("doc", 100);
  return entries.map((entry) => toMeta(entry));
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
