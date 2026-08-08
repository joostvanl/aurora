import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { registerPlugins } from "./plugins/index.js";
import { registerRoutes } from "./routes/index.js";
import { uploadsRootDir } from "./media/routes.js";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL } from "./media/limits.js";
import { isCorsOriginAllowed } from "./cors/origins.js";
import { defaultCodeForStatus } from "./lib/httpError.js";

const MAX_REQUEST_ID_LEN = 128;

export type BuildAppOptions = {
  /**
   * Fastify logger option. `false` quiets logs in tests.
   * Default: structured Pino JSON with `LOG_LEVEL` (default `info`).
   */
  logger?: FastifyServerOptions["logger"];
};

function pickIncomingRequestId(
  headers: Record<string, string | string[] | undefined>,
): string | undefined {
  const raw = headers["x-request-id"] ?? headers["x-correlation-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_REQUEST_ID_LEN
    ? trimmed.slice(0, MAX_REQUEST_ID_LEN)
    : trimmed;
}

function defaultLoggerOption(): Exclude<
  FastifyServerOptions["logger"],
  boolean | undefined
> {
  return {
    level: process.env.LOG_LEVEL?.trim() || "info",
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers[\"set-cookie\"]",
      ],
      remove: true,
    },
  };
}

/**
 * Build the Fastify app (plugins, routes, error handler) without listening.
 * Used by production boot (`index.ts`) and Vitest inject tests.
 */
export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const logger =
    options.logger === undefined ? defaultLoggerOption() : options.logger;

  const app = Fastify({
    logger,
    trustProxy: true,
    genReqId: (req) =>
      pickIncomingRequestId(
        req.headers as Record<string, string | string[] | undefined>,
      ) ?? randomUUID(),
    requestIdHeader: "x-request-id",
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      void isCorsOriginAllowed(origin)
        .then((ok) => cb(null, ok))
        .catch((err) => cb(err, false));
    },
    credentials: true,
  });

  await app.register(multipart, {
    limits: { fileSize: MAX_UPLOAD_BYTES },
  });

  const uploadsRoot = uploadsRootDir();
  await mkdir(uploadsRoot, { recursive: true });
  await app.register(fastifyStatic, {
    root: uploadsRoot,
    prefix: "/uploads/",
    decorateReply: false,
  });

  app.addHook("onSend", async (request, reply, payload) => {
    void reply.header("X-Request-Id", request.id);
    if (request.url.startsWith("/uploads/")) {
      void reply.header(
        "Cache-Control",
        "public, max-age=31536000, immutable",
      );
    }
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;

    if (error instanceof ZodError) {
      return reply.status(400).send({
        message: "Validation failed",
        code: "VALIDATION_FAILED",
        requestId,
        issues: error.issues.map((i) => ({
          path: i.path,
          code: i.code,
          message: i.message,
        })),
      });
    }

    const err = error as Error & {
      statusCode?: number;
      code?: string;
      apiCode?: string;
      issues?: unknown;
    };
    if (err.code === "FST_REQ_FILE_TOO_LARGE") {
      return reply.status(400).send({
        message: `File exceeds maximum size of ${MAX_UPLOAD_LABEL}`,
        code: "VALIDATION_FAILED",
        requestId,
      });
    }

    const statusCode =
      typeof err.statusCode === "number" ? err.statusCode : 500;

    if (statusCode >= 500) {
      request.log.error({ err: error }, err.message || "Internal Server Error");
    }

    const code =
      err.apiCode ??
      (statusCode >= 500
        ? "INTERNAL_ERROR"
        : defaultCodeForStatus(statusCode));

    return reply.status(statusCode).send({
      message: err.message || "Internal Server Error",
      code,
      requestId,
      ...(Array.isArray(err.issues) ? { issues: err.issues } : {}),
    });
  });

  await registerPlugins();
  await registerRoutes(app);

  return app;
}
