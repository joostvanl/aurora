import type { ResolvedMediaConfig } from "./config.js";
import { IMAGEKIT_PRE_TRANSFORM } from "./limits.js";

const UPLOAD_URL = "https://upload.imagekit.io/api/v1/files/upload";
const LIST_URL = "https://api.imagekit.io/v1/files";

export type ImageKitUploadResult = {
  url: string;
  fileId: string;
  name: string;
  size: number;
  filePath: string;
};

export type ImageKitLibraryItem = {
  fileId: string;
  name: string;
  url: string;
  thumbnailUrl: string;
  filePath: string;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  size: number;
  createdAt: string | null;
};

function httpError(statusCode: number, message: string) {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

function assertImageKitReady(config: ResolvedMediaConfig) {
  if (!config.privateKey || !config.publicKey || !config.urlEndpoint) {
    throw httpError(
      400,
      "ImageKit is not fully configured (public key, private key, and URL endpoint required)",
    );
  }
}

function imageKitAuthHeader(privateKey: string): string {
  return `Basic ${Buffer.from(`${privateKey}:`).toString("base64")}`;
}

async function parseImageKitJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function imageKitErrorMessage(body: unknown, fallback: string): string {
  if (
    typeof body === "object" &&
    body &&
    "message" in body &&
    typeof (body as { message: unknown }).message === "string"
  ) {
    return (body as { message: string }).message;
  }
  return fallback;
}

/**
 * Folder used to scope the media library browser.
 * Prefer the configured ImageKit settings folder; fall back to website id
 * so we never list the entire ImageKit account.
 */
export function imageKitLibraryFolderPath(
  config: ResolvedMediaConfig,
  websiteFolder?: string,
): string | null {
  const settingsFolder = config.folder?.replace(/^\/+|\/+$/g, "");
  if (settingsFolder) return `/${settingsFolder}`;
  const site = websiteFolder?.replace(/^\/+|\/+$/g, "");
  if (site) return `/${site}`;
  return null;
}

/** Same folder layout as uploads: /{settingsFolder}/{websiteId}/ */
export function imageKitUploadFolderPath(
  config: ResolvedMediaConfig,
  websiteFolder?: string,
): string | null {
  const parts = [
    config.folder?.replace(/^\/+|\/+$/g, ""),
    websiteFolder?.replace(/^\/+|\/+$/g, ""),
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return `/${parts.join("/")}`;
}

/**
 * Server-side upload to ImageKit using private API key (Basic auth).
 * @see https://imagekit.io/docs/api-reference/upload-file/upload-file
 */
export async function uploadToImageKit(input: {
  config: ResolvedMediaConfig;
  buffer: Buffer;
  filename: string;
  mimeType: string;
  /** Extra folder segment, typically websiteId for isolation. */
  websiteFolder?: string;
}): Promise<ImageKitUploadResult> {
  const { config, buffer, filename, mimeType, websiteFolder } = input;
  assertImageKitReady(config);

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(buffer)], { type: mimeType }),
    filename,
  );
  form.append("fileName", filename);
  form.append("useUniqueFileName", "true");
  form.append("publicKey", config.publicKey!);
  // Downscale/compress oversized originals before they hit the Media Library.
  form.append(
    "transformation",
    JSON.stringify({ pre: IMAGEKIT_PRE_TRANSFORM }),
  );

  const folder = imageKitUploadFolderPath(config, websiteFolder);
  if (folder) {
    form.append("folder", folder);
  }

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: imageKitAuthHeader(config.privateKey!),
    },
    body: form,
  });

  const body = await parseImageKitJson(res);

  if (!res.ok) {
    throw httpError(
      502,
      imageKitErrorMessage(body, `ImageKit upload failed (${res.status})`),
    );
  }

  if (
    typeof body !== "object" ||
    !body ||
    typeof (body as { url?: unknown }).url !== "string" ||
    typeof (body as { fileId?: unknown }).fileId !== "string" ||
    typeof (body as { name?: unknown }).name !== "string"
  ) {
    throw httpError(502, "ImageKit returned an unexpected upload response");
  }

  const result = body as {
    url: string;
    fileId: string;
    name: string;
    size?: number;
    filePath?: string;
  };

  return {
    url: result.url,
    fileId: result.fileId,
    name: result.name,
    size: typeof result.size === "number" ? result.size : buffer.length,
    filePath: typeof result.filePath === "string" ? result.filePath : "",
  };
}

/**
 * List image assets from the ImageKit media library, scoped to the folder
 * configured under Media settings (or the website folder when unset).
 * @see https://imagekit.io/docs/api-reference/media-api/list-and-search-files
 */
export async function listImageKitFiles(input: {
  config: ResolvedMediaConfig;
  /** Extra folder segment, typically websiteId — used when settings folder is empty. */
  websiteFolder?: string;
  skip?: number;
  limit?: number;
  /** Lucene-like name search, e.g. name: "hero" */
  search?: string;
}): Promise<{ items: ImageKitLibraryItem[]; skip: number; limit: number }> {
  const { config } = input;
  assertImageKitReady(config);

  const skip = Math.max(0, input.skip ?? 0);
  const limit = Math.min(100, Math.max(1, input.limit ?? 48));

  const params = new URLSearchParams({
    fileType: "image",
    skip: String(skip),
    limit: String(limit),
    sort: "DESC_CREATED",
  });

  // Prefer searchQuery so we can scope recursively under the configured folder.
  // ImageKit's `path` query param only searches one folder level (no nested).
  const clauses: string[] = [`type = "file"`];
  const folder = imageKitLibraryFolderPath(config, input.websiteFolder);
  if (folder) {
    // Colon operator: folder + all subfolders
    const scoped = folder.endsWith("/") ? folder : `${folder}/`;
    clauses.push(`path: "${scoped}"`);
  }

  const search = input.search?.trim();
  if (search) {
    const safe = search.replace(/"/g, "");
    clauses.push(`name: "${safe}"`);
  }

  params.set("searchQuery", clauses.join(" AND "));

  const res = await fetch(`${LIST_URL}?${params.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: imageKitAuthHeader(config.privateKey!),
    },
  });

  const body = await parseImageKitJson(res);

  if (!res.ok) {
    throw httpError(
      502,
      imageKitErrorMessage(body, `ImageKit list failed (${res.status})`),
    );
  }

  if (!Array.isArray(body)) {
    throw httpError(502, "ImageKit returned an unexpected list response");
  }

  const items: ImageKitLibraryItem[] = [];
  for (const raw of body) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (typeof row.url !== "string" || typeof row.fileId !== "string") continue;
    if (typeof row.name !== "string") continue;

    items.push({
      fileId: row.fileId,
      name: row.name,
      url: row.url,
      thumbnailUrl:
        typeof row.thumbnail === "string" && row.thumbnail
          ? row.thumbnail
          : row.url,
      filePath: typeof row.filePath === "string" ? row.filePath : "",
      mimeType: typeof row.mime === "string" ? row.mime : null,
      width: typeof row.width === "number" ? row.width : null,
      height: typeof row.height === "number" ? row.height : null,
      size: typeof row.size === "number" ? row.size : 0,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : null,
    });
  }

  return { items, skip, limit };
}
