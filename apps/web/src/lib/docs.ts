import fs from "node:fs/promises";
import path from "node:path";

export type DocMeta = {
  slug: string;
  title: string;
  description: string;
  order: number;
};

/** Canonical reading order for the product docs site. */
export const DOC_CATALOG: DocMeta[] = [
  {
    slug: "readme",
    title: "Start here",
    description: "Index and absolute rules for Aurora",
    order: 0,
  },
  {
    slug: "overview",
    title: "Overview",
    description: "What Aurora is and is not",
    order: 1,
  },
  {
    slug: "multi-tenancy",
    title: "Multi-tenancy & auth",
    description: "Accounts, site keys, JWT vs public read",
    order: 2,
  },
  {
    slug: "content-model",
    title: "Content model",
    description: "Types, fields, entries, publishing",
    order: 3,
  },
  {
    slug: "response-shapes",
    title: "Response shapes",
    description: "FlatEntry and ContentType JSON",
    order: 4,
  },
  {
    slug: "public-api",
    title: "Public API",
    description: "Endpoints, headers, curl cookbook",
    order: 5,
  },
  {
    slug: "forms",
    title: "Forms",
    description: "Form builder, public submit, embeds",
    order: 6,
  },
  {
    slug: "management-api",
    title: "Management API",
    description: "Write types & content (agents, tokens, provision)",
    order: 7,
  },
  {
    slug: "demo-content-map",
    title: "Site content map",
    description: "Seeded product-site types and routes",
    order: 8,
  },
  {
    slug: "frontend-playbook",
    title: "Frontend playbook",
    description: "Build a frontend step by step",
    order: 9,
  },
  {
    slug: "typed-client",
    title: "Typed client",
    description: "@cms/shared CmsClient",
    order: 10,
  },
  {
    slug: "errors-and-gotchas",
    title: "Errors & gotchas",
    description: "Common integration failures",
    order: 11,
  },
  {
    slug: "admin-api",
    title: "Admin API",
    description: "Pointer to Management API",
    order: 12,
  },
];

const FILE_BY_SLUG: Record<string, string> = {
  readme: "README.md",
  overview: "overview.md",
  "multi-tenancy": "multi-tenancy.md",
  "content-model": "content-model.md",
  "response-shapes": "response-shapes.md",
  "public-api": "public-api.md",
  forms: "forms.md",
  "management-api": "management-api.md",
  "demo-content-map": "demo-content-map.md",
  "frontend-playbook": "frontend-playbook.md",
  "typed-client": "typed-client.md",
  "errors-and-gotchas": "errors-and-gotchas.md",
  "admin-api": "admin-api.md",
};

function docsRoot() {
  const fromEnv = process.env.DOCS_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  // apps/web → repo root → docs (local `next dev` / `next start` from apps/web)
  return path.resolve(process.cwd(), "../../docs");
}

export function getDocMeta(slug: string): DocMeta | undefined {
  return DOC_CATALOG.find((d) => d.slug === slug);
}

export async function readDocMarkdown(slug: string): Promise<string | null> {
  const file = FILE_BY_SLUG[slug];
  if (!file) return null;
  const full = path.join(docsRoot(), file);
  try {
    return await fs.readFile(full, "utf8");
  } catch {
    return null;
  }
}

export function rewriteDocLinks(markdown: string): string {
  return markdown
    .replace(/\]\(\.\/README\.md\)/gi, "](/docs)")
    .replace(/\]\(\.\/([a-z0-9-]+)\.md\)/gi, "](/docs/$1)")
    .replace(/\]\(([a-z0-9-]+)\.md\)/gi, "](/docs/$1)");
}
