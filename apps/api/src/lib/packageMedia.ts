import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { uploadsRootDir } from "../media/routes.js";

const UPLOAD_PATH_RE = /\/uploads\/([^/]+)\/([^/?#]+)/g;

export type MediaMapEntry = {
  fromUrl: string;
  path: string;
};

function collectUrlsFromValue(value: unknown, out: Set<string>) {
  if (typeof value === "string") {
    out.add(value);
    return;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.url === "string") out.add(obj.url);
    if (typeof obj.src === "string") out.add(obj.src);
  }
}

/** Collect candidate media URLs from entry field values. */
export function collectMediaUrlsFromFields(
  fields: Record<string, unknown>,
): string[] {
  const urls = new Set<string>();
  for (const value of Object.values(fields)) {
    collectUrlsFromValue(value, urls);
  }
  return [...urls];
}

export function parseUploadRef(
  url: string,
  websiteId: string,
): { websiteId: string; filename: string } | null {
  const match = url.match(/\/uploads\/([^/]+)\/([^/?#]+)/);
  if (!match) return null;
  const [, wid, filename] = match;
  if (wid !== websiteId) return null;
  if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return null;
  }
  return { websiteId: wid, filename };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve local upload files referenced by entries for a website.
 * Returns media-map entries and absolute disk paths keyed by zip-relative path.
 */
export async function collectPackageMedia(
  websiteId: string,
  fieldRecords: Array<Record<string, unknown>>,
): Promise<{
  mediaMap: MediaMapEntry[];
  files: Map<string, Buffer>;
}> {
  const seenFromUrl = new Set<string>();
  const mediaMap: MediaMapEntry[] = [];
  const files = new Map<string, Buffer>();
  const filenameToZipPath = new Map<string, string>();

  for (const fields of fieldRecords) {
    for (const url of collectMediaUrlsFromFields(fields)) {
      if (seenFromUrl.has(url)) continue;
      const ref = parseUploadRef(url, websiteId);
      if (!ref) continue;

      const diskPath = path.join(uploadsRootDir(), websiteId, ref.filename);
      if (!(await fileExists(diskPath))) continue;

      seenFromUrl.add(url);

      let zipRel = filenameToZipPath.get(ref.filename);
      if (!zipRel) {
        const ext = path.extname(ref.filename) || "";
        const hash = createHash("sha256")
          .update(ref.filename)
          .digest("hex")
          .slice(0, 12);
        zipRel = `media/${hash}${ext}`;
        filenameToZipPath.set(ref.filename, zipRel);
        files.set(zipRel, await readFile(diskPath));
      }

      mediaMap.push({ fromUrl: url, path: zipRel });
    }
  }

  return { mediaMap, files };
}

function rewriteValueUrls(
  value: unknown,
  urlMap: Map<string, string>,
): unknown {
  if (typeof value === "string") {
    return urlMap.get(value) ?? value;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = { ...(value as Record<string, unknown>) };
    let changed = false;
    for (const key of ["url", "src"] as const) {
      if (typeof obj[key] === "string" && urlMap.has(obj[key] as string)) {
        obj[key] = urlMap.get(obj[key] as string)!;
        changed = true;
      }
    }
    return changed ? obj : value;
  }
  return value;
}

/** Rewrite media URLs in entry fields using fromUrl → newUrl map. */
export function rewriteEntryFieldsMedia(
  fields: Record<string, unknown>,
  urlMap: Map<string, string>,
): Record<string, unknown> {
  if (urlMap.size === 0) return fields;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    next[key] = rewriteValueUrls(value, urlMap);
  }
  return next;
}

/**
 * Also rewrite any remaining `/uploads/{oldId}/file` substrings inside string
 * fields (e.g. HTML richtext) when covered by media-map.
 */
export function rewriteStringUploadsInFields(
  fields: Record<string, unknown>,
  websiteId: string,
  filenameToNewUrl: Map<string, string>,
): Record<string, unknown> {
  if (filenameToNewUrl.size === 0) return fields;

  function rewriteString(s: string): string {
    return s.replace(UPLOAD_PATH_RE, (full, wid: string, filename: string) => {
      if (wid !== websiteId) return full;
      return filenameToNewUrl.get(filename) ?? full;
    });
  }

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") {
      next[key] = rewriteString(value);
    } else {
      next[key] = value;
    }
  }
  return next;
}

export function publicApiBaseFromRequest(request: {
  protocol: string;
  headers: { host?: string };
}): string {
  const fromEnv = process.env.PUBLIC_API_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const host = request.headers.host ?? "localhost:4000";
  return `${request.protocol}://${host}`;
}

/**
 * Materialize package media files into the target website uploads dir.
 * Returns map of package fromUrl → new public URL.
 */
export async function importPackageMedia(params: {
  websiteId: string;
  mediaMap: MediaMapEntry[];
  getFile: (zipPath: string) => Promise<Buffer | null>;
  publicBase: string;
}): Promise<{
  urlMap: Map<string, string>;
  imported: number;
  skipped: number;
  errors: string[];
}> {
  const urlMap = new Map<string, string>();
  const zipPathToNewUrl = new Map<string, string>();
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  const dir = path.join(uploadsRootDir(), params.websiteId);
  await mkdir(dir, { recursive: true });

  for (const entry of params.mediaMap) {
    if (!entry.path.startsWith("media/") || entry.path.includes("..")) {
      errors.push(`Invalid media path: ${entry.path}`);
      skipped += 1;
      continue;
    }

    let newUrl = zipPathToNewUrl.get(entry.path);
    if (!newUrl) {
      const buf = await params.getFile(entry.path);
      if (!buf) {
        errors.push(`Missing media file in package: ${entry.path}`);
        skipped += 1;
        continue;
      }
      const ext = path.extname(entry.path) || ".bin";
      const filename = `${randomUUID()}${ext}`;
      await writeFile(path.join(dir, filename), buf);
      newUrl = `${params.publicBase}/uploads/${params.websiteId}/${filename}`;
      zipPathToNewUrl.set(entry.path, newUrl);
      imported += 1;
    }

    urlMap.set(entry.fromUrl, newUrl);
  }

  return { urlMap, imported, skipped, errors };
}
