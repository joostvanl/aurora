import dotenv from "dotenv";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { registerPlugins } from "./plugins/index.js";
import { registerRoutes } from "./routes/index.js";
import { uploadsRootDir } from "./media/routes.js";
import { isCorsOriginAllowed } from "./cors/origins.js";

// Prefer monorepo root `.env` (documented), then allow `apps/api/.env` overrides.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../.env") });
dotenv.config({ path: path.resolve(here, "../../../.env"), override: true });

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

async function main() {
  const app = Fastify({ logger: true });

  await app.register(cors, {
    // Global CORS_ORIGINS (studio) ∪ Website.allowedOrigins (per tenant frontends).
    origin: (origin, cb) => {
      void isCorsOriginAllowed(origin)
        .then((ok) => cb(null, ok))
        .catch((err) => cb(err, false));
    },
    credentials: true,
  });

  await app.register(multipart, {
    limits: { fileSize: 5 * 1024 * 1024 },
  });

  const uploadsRoot = uploadsRootDir();
  await mkdir(uploadsRoot, { recursive: true });
  await app.register(fastifyStatic, {
    root: uploadsRoot,
    prefix: "/uploads/",
    decorateReply: false,
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        message: "Validation failed",
        issues: error.issues,
      });
    }

    const err = error as Error & { statusCode?: number; code?: string };
    if (err.code === "FST_REQ_FILE_TOO_LARGE") {
      return reply.status(400).send({ message: "File exceeds maximum size of 5MB" });
    }

    const statusCode =
      typeof err.statusCode === "number" ? err.statusCode : 500;

    if (statusCode >= 500) {
      app.log.error(error);
    }

    return reply.status(statusCode).send({
      message: err.message || "Internal Server Error",
    });
  });

  await registerPlugins();
  await registerRoutes(app);

  await app.listen({ port, host });
  app.log.info(`CMS API listening on http://${host}:${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
