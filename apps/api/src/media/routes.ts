import type { FastifyInstance } from "fastify";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MediaConfigUpdateSchema } from "@cms/shared";
import {
  requireWebsite,
  websiteIdFrom,
} from "../auth/middleware.js";
import { RolePermission } from "../auth/roles.js";
import { resolveMediaConfig, toPublicMediaStatus, updateMediaConfig } from "./config.js";
import { listImageKitFiles, uploadToImageKit } from "./imagekit.js";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "./limits.js";

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

function tooLargeError() {
  return httpError(400, `File exceeds maximum size of ${MAX_UPLOAD_LABEL}`);
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

    admin.get("/api/v1/admin/media/status", async (request) => {
      return toPublicMediaStatus(websiteIdFrom(request));
    });

    admin.put(
      "/api/v1/admin/media/config",
      { preHandler: requireWebsite(RolePermission.admin) },
      async (request) => {
        const body = MediaConfigUpdateSchema.parse(request.body);
        return updateMediaConfig(websiteIdFrom(request), body);
      },
    );

    admin.get("/api/v1/admin/media/library", async (request) => {
      const websiteId = websiteIdFrom(request);
      const config = await resolveMediaConfig(websiteId);

      if (!config.imagekitConfigured) {
        throw httpError(
          400,
          "ImageKit is not configured for this website. Set it under Settings → Media storage.",
        );
      }

      const query = request.query as {
        skip?: string;
        limit?: string;
        q?: string;
      };
      const skip = Number(query.skip ?? 0);
      const limit = Number(query.limit ?? 48);
      const listed = await listImageKitFiles({
        config,
        websiteFolder: websiteId,
        skip: Number.isFinite(skip) ? skip : 0,
        limit: Number.isFinite(limit) ? limit : 48,
        search: typeof query.q === "string" ? query.q : undefined,
      });

      return {
        provider: "imagekit" as const,
        items: listed.items,
        skip: listed.skip,
        limit: listed.limit,
        hasMore: listed.items.length >= listed.limit,
      };
    });

    admin.post("/api/v1/admin/media", async (request) => {
      const websiteId = websiteIdFrom(request);
      const file = await request.file({
        limits: { fileSize: MAX_UPLOAD_BYTES },
      });

      if (!file) {
        throw httpError(400, 'Expected multipart field "file"');
      }

      const ext = ALLOWED_MIME[file.mimetype];
      if (!ext) {
        throw httpError(
          400,
          "Only image/jpeg, image/png, image/webp, and image/gif are allowed",
        );
      }

      const filename = `${randomUUID()}${ext}`;
      const config = await resolveMediaConfig(websiteId);

      if (config.provider === "imagekit") {
        let buffer: Buffer;
        try {
          buffer = await file.toBuffer();
        } catch (err) {
          const e = err as Error & { code?: string };
          if (e.code === "FST_REQ_FILE_TOO_LARGE") {
            throw tooLargeError();
          }
          throw err;
        }
        if (file.file.truncated || buffer.length > MAX_UPLOAD_BYTES) {
          throw tooLargeError();
        }

        const uploaded = await uploadToImageKit({
          config,
          buffer,
          filename,
          mimeType: file.mimetype,
          websiteFolder: websiteId,
        });

        return {
          url: uploaded.url,
          filename: uploaded.name || filename,
          mimeType: file.mimetype,
          size: uploaded.size,
          provider: "imagekit" as const,
          fileId: uploaded.fileId,
        };
      }

      const dir = path.join(uploadsRootDir(), websiteId);
      await mkdir(dir, { recursive: true });
      const dest = path.join(dir, filename);

      try {
        await pipeline(file.file, createWriteStream(dest));
      } catch (err) {
        const e = err as Error & { code?: string };
        if (e.code === "FST_REQ_FILE_TOO_LARGE") {
          throw tooLargeError();
        }
        throw err;
      }

      if (file.file.truncated) {
        throw tooLargeError();
      }

      const url = `${publicApiBase(request)}/uploads/${websiteId}/${filename}`;

      return {
        url,
        filename,
        mimeType: file.mimetype,
        size: file.file.bytesRead,
        provider: "local" as const,
      };
    });
  });
}
