import type { FastifyInstance } from "fastify";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  requireWebsite,
  websiteIdFrom,
} from "../auth/middleware.js";
import { RolePermission } from "../auth/roles.js";

const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function httpError(statusCode: number, message: string) {
  const err = new Error(message) as Error & { statusCode: number };
  err.statusCode = statusCode;
  return err;
}

/** Uploads root: `UPLOADS_DIR` in containers, else monorepo-root `uploads/`. */
export function uploadsRootDir(): string {
  const fromEnv = process.env.UPLOADS_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../../uploads");
}

function publicApiBase(request: {
  protocol: string;
  headers: { host?: string };
}): string {
  const fromEnv = process.env.PUBLIC_API_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const host = request.headers.host ?? "localhost:4000";
  return `${request.protocol}://${host}`;
}

export async function registerMediaRoutes(app: FastifyInstance) {
  app.register(async (admin) => {
    admin.addHook("preHandler", requireWebsite(RolePermission.content));

    admin.post("/api/v1/admin/media", async (request) => {
      const websiteId = websiteIdFrom(request);
      const file = await request.file({
        limits: { fileSize: MAX_BYTES },
      });

      if (!file) {
        throw httpError(400, "Expected multipart field \"file\"");
      }

      const ext = ALLOWED_MIME[file.mimetype];
      if (!ext) {
        throw httpError(
          400,
          "Only image/jpeg, image/png, image/webp, and image/gif are allowed",
        );
      }

      const filename = `${randomUUID()}${ext}`;
      const dir = path.join(uploadsRootDir(), websiteId);
      await mkdir(dir, { recursive: true });
      const dest = path.join(dir, filename);

      try {
        await pipeline(file.file, createWriteStream(dest));
      } catch (err) {
        const e = err as Error & { code?: string };
        if (e.code === "FST_REQ_FILE_TOO_LARGE") {
          throw httpError(400, "File exceeds maximum size of 5MB");
        }
        throw err;
      }

      if (file.file.truncated) {
        throw httpError(400, "File exceeds maximum size of 5MB");
      }

      const url = `${publicApiBase(request)}/uploads/${websiteId}/${filename}`;

      return {
        url,
        filename,
        mimeType: file.mimetype,
        size: file.file.bytesRead,
      };
    });
  });
}
