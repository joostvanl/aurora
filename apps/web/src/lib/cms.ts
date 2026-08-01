import { createCmsClient, type FlatEntry } from "@cms/shared";

export function getPublicClient() {
  const baseUrl = process.env.NEXT_PUBLIC_CMS_API_URL ?? "http://localhost:4000";
  const siteKey = process.env.NEXT_PUBLIC_CMS_SITE_KEY ?? process.env.CMS_SITE_KEY;
  if (!siteKey) {
    throw new Error(
      "NEXT_PUBLIC_CMS_SITE_KEY is not set (use the siteKey from your CMS account)",
    );
  }
  return createCmsClient({ baseUrl, siteKey });
}

export function fieldString(entry: FlatEntry, key: string, fallback = ""): string {
  const value = entry.fields[key];
  return typeof value === "string" ? value : fallback;
}

/** Strip tags / normalize whitespace for teasers from richtext fields. */
export function plainTextExcerpt(value: string, maxLen = 220): string {
  const plain = value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxLen) return plain;
  return `${plain.slice(0, maxLen).trimEnd()}…`;
}

/** First N words of a richtext/plain field, for list teasers. */
export function plainTextWordTeaser(value: string, wordCount = 20): string {
  const plain = value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "";
  const words = plain.split(" ");
  if (words.length <= wordCount) return plain;
  return `${words.slice(0, wordCount).join(" ")}…`;
}

export function fieldNumber(entry: FlatEntry, key: string, fallback = 0): number {
  const value = entry.fields[key];
  return typeof value === "number" ? value : fallback;
}

/** Media fields store a public image URL string (or empty). Also accepts `{ url }` objects. */
export function fieldMedia(
  entry: FlatEntry,
  key: string,
): { url: string; alt: string } | null {
  const value = entry.fields[key];
  if (typeof value === "string" && value.trim()) {
    return { url: value.trim(), alt: "" };
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const url =
      typeof obj.url === "string"
        ? obj.url.trim()
        : typeof obj.src === "string"
          ? obj.src.trim()
          : "";
    if (!url) return null;
    const alt =
      typeof obj.alt === "string"
        ? obj.alt
        : typeof obj.label === "string"
          ? obj.label
          : typeof obj.name === "string"
            ? obj.name
            : "";
    return { url, alt };
  }
  return null;
}

export function sortByOrder(entries: FlatEntry[]): FlatEntry[] {
  return entries
    .slice()
    .sort((a, b) => fieldNumber(a, "sortOrder") - fieldNumber(b, "sortOrder"));
}

export async function getSiteSettings(): Promise<FlatEntry | null> {
  try {
    return await getPublicClient().getPublishedEntry("site_settings", "default");
  } catch {
    return null;
  }
}

export async function getNavItems(): Promise<FlatEntry[]> {
  try {
    const { items } = await getPublicClient().listPublishedEntries("nav_item", {
      limit: 50,
    });
    return sortByOrder(items);
  } catch {
    return [];
  }
}

export async function listType(apiId: string, limit = 50): Promise<FlatEntry[]> {
  try {
    const { items } = await getPublicClient().listPublishedEntries(apiId, { limit });
    return sortByOrder(items);
  } catch {
    return [];
  }
}

export async function getEntry(
  apiId: string,
  slug: string,
): Promise<FlatEntry | null> {
  try {
    return await getPublicClient().getPublishedEntry(apiId, slug);
  } catch {
    return null;
  }
}
