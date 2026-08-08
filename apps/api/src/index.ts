import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";

// Prefer monorepo root `.env` (documented), then allow `apps/api/.env` overrides.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../.env") });
dotenv.config({ path: path.resolve(here, "../../../.env"), override: true });

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

async function main() {
  const app = await buildApp();
  await app.listen({ port, host });
  app.log.info(`CMS API listening on http://${host}:${port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
