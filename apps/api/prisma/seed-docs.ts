import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EntryStatus, FieldType, PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../../../.env") });
dotenv.config({ path: path.resolve(here, "../.env"), override: false });

const prisma = new PrismaClient();

const DEMO_SITE_KEY = "demo-site-key";

export const DOC_SPECS: Array<{
  slug: string;
  title: string;
  description: string;
  file: string;
  sortOrder: number;
}> = [
  {
    slug: "readme",
    title: "Start here",
    description: "Index and absolute rules for Aurora",
    file: "README.md",
    sortOrder: 0,
  },
  {
    slug: "overview",
    title: "Overview",
    description: "What Aurora is and is not",
    file: "overview.md",
    sortOrder: 1,
  },
  {
    slug: "multi-tenancy",
    title: "Multi-tenancy & auth",
    description: "Accounts, site keys, JWT vs public read",
    file: "multi-tenancy.md",
    sortOrder: 2,
  },
  {
    slug: "content-model",
    title: "Content model",
    description: "Types, fields, entries, publishing",
    file: "content-model.md",
    sortOrder: 3,
  },
  {
    slug: "response-shapes",
    title: "Response shapes",
    description: "FlatEntry and ContentType JSON",
    file: "response-shapes.md",
    sortOrder: 4,
  },
  {
    slug: "public-api",
    title: "Public API",
    description: "Endpoints, headers, curl cookbook",
    file: "public-api.md",
    sortOrder: 5,
  },
  {
    slug: "forms",
    title: "Forms",
    description: "Form builder, public submit, embeds",
    file: "forms.md",
    sortOrder: 6,
  },
  {
    slug: "management-api",
    title: "Management API",
    description: "Write types & content (agents, tokens, provision)",
    file: "management-api.md",
    sortOrder: 7,
  },
  {
    slug: "mcp",
    title: "MCP server",
    description: "stdio MCP for Cursor (website-scoped tokens)",
    file: "mcp.md",
    sortOrder: 8,
  },
  {
    slug: "demo-content-map",
    title: "Site content map",
    description: "Seeded product-site types and routes",
    file: "demo-content-map.md",
    sortOrder: 9,
  },
  {
    slug: "frontend-playbook",
    title: "Frontend playbook",
    description: "Build a frontend step by step",
    file: "frontend-playbook.md",
    sortOrder: 10,
  },
  {
    slug: "typed-client",
    title: "Typed client",
    description: "@cms/shared CmsClient",
    file: "typed-client.md",
    sortOrder: 11,
  },
  {
    slug: "errors-and-gotchas",
    title: "Errors & gotchas",
    description: "Common integration failures",
    file: "errors-and-gotchas.md",
    sortOrder: 12,
  },
  {
    slug: "admin-api",
    title: "Admin API",
    description: "Pointer to Management API",
    file: "admin-api.md",
    sortOrder: 13,
  },
  {
    slug: "deploy-raspberry-pi",
    title: "Deploy on Raspberry Pi",
    description: "Docker Compose, Cloudflare Tunnel, GitHub Actions",
    file: "deploy-raspberry-pi.md",
    sortOrder: 14,
  },
];

function docsDir() {
  return path.resolve(here, "../../../docs");
}

function rewriteDocLinks(markdown: string): string {
  return markdown
    .replace(/\]\(\.\/README\.md\)/gi, "](/docs)")
    .replace(/\]\(\.\/([a-z0-9-]+)\.md\)/gi, "](/docs/$1)")
    .replace(/\]\(([a-z0-9-]+)\.md\)/gi, "](/docs/$1)");
}

async function ensureDocType(websiteId: string) {
  let contentType = await prisma.contentType.findUnique({
    where: { websiteId_apiId: { websiteId, apiId: "doc" } },
    include: { fields: true },
  });

  const fields = [
    { apiId: "title", name: "Title", type: FieldType.text, required: true, sortOrder: 0 },
    { apiId: "slug", name: "Slug", type: FieldType.slug, required: true, sortOrder: 1 },
    {
      apiId: "description",
      name: "Description",
      type: FieldType.text,
      required: false,
      sortOrder: 2,
    },
    {
      apiId: "body",
      name: "Body (Markdown)",
      type: FieldType.textarea,
      required: true,
      sortOrder: 3,
      settings: { contentFormat: "markdown" as const },
    },
    {
      apiId: "sortOrder",
      name: "Sort order",
      type: FieldType.number,
      required: false,
      sortOrder: 4,
    },
  ];

  if (!contentType) {
    contentType = await prisma.contentType.create({
      data: {
        websiteId,
        apiId: "doc",
        name: "Documentation",
        description: "Product docs served at /docs (Markdown body)",
        fields: {
          create: fields.map((f) => ({
            apiId: f.apiId,
            name: f.name,
            type: f.type,
            required: f.required,
            sortOrder: f.sortOrder,
            ...("settings" in f && f.settings
              ? { settings: f.settings as object }
              : {}),
          })),
        },
      },
      include: { fields: true },
    });
    return contentType;
  }

  await prisma.contentType.update({
    where: { id: contentType.id },
    data: {
      name: "Documentation",
      description: "Product docs served at /docs (Markdown body)",
    },
  });

  const existing = new Map(contentType.fields.map((f) => [f.apiId, f]));
  for (const field of fields) {
    const current = existing.get(field.apiId);
    if (current) {
      await prisma.fieldDefinition.update({
        where: { id: current.id },
        data: {
          name: field.name,
          type: field.type,
          required: field.required,
          sortOrder: field.sortOrder,
          settings:
            "settings" in field && field.settings
              ? (field.settings as object)
              : Prisma.JsonNull,
        },
      });
    } else {
      await prisma.fieldDefinition.create({
        data: {
          contentTypeId: contentType.id,
          apiId: field.apiId,
          name: field.name,
          type: field.type,
          required: field.required,
          sortOrder: field.sortOrder,
          ...("settings" in field && field.settings
            ? { settings: field.settings as object }
            : {}),
        },
      });
    }
  }

  return prisma.contentType.findUniqueOrThrow({
    where: { websiteId_apiId: { websiteId, apiId: "doc" } },
    include: { fields: true },
  });
}

async function upsertDocEntry(
  websiteId: string,
  slug: string,
  fields: Record<string, unknown>,
) {
  const contentType = await prisma.contentType.findUniqueOrThrow({
    where: { websiteId_apiId: { websiteId, apiId: "doc" } },
    include: { fields: true },
  });
  const fieldMap = new Map(contentType.fields.map((f) => [f.apiId, f]));

  let entry = await prisma.entry.findUnique({
    where: {
      contentTypeId_slug_locale: {
        contentTypeId: contentType.id,
        slug,
        locale: "en-US",
      },
    },
  });

  if (!entry) {
    entry = await prisma.entry.create({
      data: {
        contentTypeId: contentType.id,
        slug,
        status: EntryStatus.published,
        locale: "en-US",
        publishedAt: new Date(),
      },
    });
  } else {
    entry = await prisma.entry.update({
      where: { id: entry.id },
      data: {
        status: EntryStatus.published,
        publishedAt: entry.publishedAt ?? new Date(),
      },
    });
  }

  for (const [apiId, value] of Object.entries(fields)) {
    const def = fieldMap.get(apiId);
    if (!def) continue;
    await prisma.entryFieldValue.upsert({
      where: { entryId_fieldId: { entryId: entry.id, fieldId: def.id } },
      create: {
        entryId: entry.id,
        fieldId: def.id,
        value: value as Prisma.InputJsonValue,
      },
      update: { value: value as Prisma.InputJsonValue },
    });
  }
}

/** Upsert content type `doc` and all markdown pages from repo `docs/`. */
export async function seedDocsForWebsite(websiteId: string) {
  await ensureDocType(websiteId);
  const root = docsDir();

  for (const spec of DOC_SPECS) {
    const full = path.join(root, spec.file);
    const raw = await fs.readFile(full, "utf8");
    await upsertDocEntry(websiteId, spec.slug, {
      title: spec.title,
      slug: spec.slug,
      description: spec.description,
      body: rewriteDocLinks(raw),
      sortOrder: spec.sortOrder,
    });
  }

  const contentType = await prisma.contentType.findUniqueOrThrow({
    where: { websiteId_apiId: { websiteId, apiId: "doc" } },
  });
  const keep = new Set(DOC_SPECS.map((d) => d.slug));
  await prisma.entry.deleteMany({
    where: {
      contentTypeId: contentType.id,
      slug: { notIn: [...keep] },
    },
  });

  return DOC_SPECS.length;
}

async function main() {
  const website = await prisma.website.findUnique({
    where: { siteKey: DEMO_SITE_KEY },
  });
  if (!website) {
    throw new Error(
      `Website with siteKey=${DEMO_SITE_KEY} not found. Run full db:seed first.`,
    );
  }
  const n = await seedDocsForWebsite(website.id);
  console.log(`Seeded ${n} doc entries for siteKey=${DEMO_SITE_KEY}`);
}

const isDirect =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
