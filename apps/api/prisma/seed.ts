import { PrismaClient, FieldType, EntryStatus, FormFieldType, Prisma } from "@prisma/client";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../../../.env") });
dotenv.config({ path: path.resolve(here, "../.env"), override: false });

const prisma = new PrismaClient();

const DEMO_EMAIL = "demo@aurora.local";
const DEMO_PASSWORD = "demo-demo-demo";
const DEMO_SITE_KEY = "demo-site-key";
/** Local-only management token for site-building agents (seeded). */
export const DEMO_API_TOKEN = "aur_live_demo_write_token_change_me";

type FieldSpec = {
  apiId: string;
  name: string;
  type: FieldType;
  required?: boolean;
  sortOrder: number;
  settings?: {
    relatedContentTypeApiId?: string;
    contentFormat?: "html" | "markdown" | "plain";
  } | null;
};

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function ensureDemoUser() {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash: hashPassword(DEMO_PASSWORD),
        name: "Demo Editor",
      },
    });
  }
  return prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Demo Editor",
      passwordHash: hashPassword(DEMO_PASSWORD),
    },
  });
}

async function ensureDemoWebsite(userId: string) {
  const membership = await prisma.membership.findFirst({
    where: { userId, role: "admin" },
    include: { website: true },
    orderBy: { createdAt: "asc" },
  });

  if (membership) {
    return prisma.website.update({
      where: { id: membership.websiteId },
      data: {
        name: "Aurora Demo",
        siteKey: DEMO_SITE_KEY,
        locales: ["en-US", "nl-NL"],
        defaultLocale: "en-US",
        allowedOrigins: [
          "http://localhost:3000",
          "http://localhost:3001",
          "http://127.0.0.1:3000",
          "http://127.0.0.1:3001",
        ],
      },
    });
  }

  // Prefer remapping migrated website that already holds demo-site-key
  const byKey = await prisma.website.findUnique({
    where: { siteKey: DEMO_SITE_KEY },
  });
  if (byKey) {
    await prisma.membership.upsert({
      where: {
        userId_websiteId: { userId, websiteId: byKey.id },
      },
      create: { userId, websiteId: byKey.id, role: "admin" },
      update: { role: "admin" },
    });
    return prisma.website.update({
      where: { id: byKey.id },
      data: {
        name: "Aurora Demo",
        locales: ["en-US", "nl-NL"],
        defaultLocale: "en-US",
        allowedOrigins: [
          "http://localhost:3000",
          "http://localhost:3001",
          "http://127.0.0.1:3000",
          "http://127.0.0.1:3001",
        ],
      },
    });
  }

  return prisma.website.create({
    data: {
      name: "Aurora Demo",
      siteKey: DEMO_SITE_KEY,
      locales: ["en-US", "nl-NL"],
      defaultLocale: "en-US",
      allowedOrigins: [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
      ],
      memberships: {
        create: { userId, role: "admin" },
      },
    },
  });
}

async function ensureType(
  websiteId: string,
  apiId: string,
  name: string,
  description: string,
  fields: FieldSpec[],
) {
  let contentType = await prisma.contentType.findUnique({
    where: { websiteId_apiId: { websiteId, apiId } },
    include: { fields: true },
  });

  if (!contentType) {
    contentType = await prisma.contentType.create({
      data: {
        websiteId,
        apiId,
        name,
        description,
        fields: {
          create: fields.map((f) => ({
            apiId: f.apiId,
            name: f.name,
            type: f.type,
            required: f.required ?? false,
            sortOrder: f.sortOrder,
            ...(f.settings
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
    data: { name, description },
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
          required: field.required ?? false,
          sortOrder: field.sortOrder,
          settings: field.settings
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
          required: field.required ?? false,
          sortOrder: field.sortOrder,
          ...(field.settings ? { settings: field.settings as object } : {}),
        },
      });
    }
  }

  return prisma.contentType.findUniqueOrThrow({
    where: { websiteId_apiId: { websiteId, apiId } },
    include: { fields: true },
  });
}

type FormFieldSpec = {
  apiId: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: Array<{ value: string; label: string }>;
  sortOrder: number;
};

async function ensureForm(
  websiteId: string,
  apiId: string,
  meta: {
    name: string;
    description?: string;
    submitLabel?: string;
    successMessage?: string;
    enabled?: boolean;
  },
  fields: FormFieldSpec[],
) {
  let form = await prisma.form.findUnique({
    where: { websiteId_apiId: { websiteId, apiId } },
    include: { fields: true },
  });

  if (!form) {
    form = await prisma.form.create({
      data: {
        websiteId,
        apiId,
        name: meta.name,
        description: meta.description,
        submitLabel: meta.submitLabel ?? "Submit",
        successMessage:
          meta.successMessage ?? "Thanks — we received your message.",
        enabled: meta.enabled ?? true,
        fields: {
          create: fields.map((f) => ({
            apiId: f.apiId,
            label: f.label,
            type: f.type,
            required: f.required ?? false,
            placeholder: f.placeholder ?? null,
            helpText: f.helpText ?? null,
            options: (f.options ?? null) as Prisma.InputJsonValue,
            sortOrder: f.sortOrder,
          })),
        },
      },
      include: { fields: true },
    });
    return form;
  }

  await prisma.form.update({
    where: { id: form.id },
    data: {
      name: meta.name,
      description: meta.description ?? null,
      submitLabel: meta.submitLabel ?? form.submitLabel,
      successMessage: meta.successMessage ?? form.successMessage,
      enabled: meta.enabled ?? form.enabled,
    },
  });

  const existing = new Map(form.fields.map((f) => [f.apiId, f]));
  for (const field of fields) {
    const current = existing.get(field.apiId);
    if (current) {
      await prisma.formField.update({
        where: { id: current.id },
        data: {
          label: field.label,
          type: field.type,
          required: field.required ?? false,
          placeholder: field.placeholder ?? null,
          helpText: field.helpText ?? null,
          options: (field.options ?? null) as Prisma.InputJsonValue,
          sortOrder: field.sortOrder,
        },
      });
    } else {
      await prisma.formField.create({
        data: {
          formId: form.id,
          apiId: field.apiId,
          label: field.label,
          type: field.type,
          required: field.required ?? false,
          placeholder: field.placeholder ?? null,
          helpText: field.helpText ?? null,
          options: (field.options ?? null) as Prisma.InputJsonValue,
          sortOrder: field.sortOrder,
        },
      });
    }
  }

  return prisma.form.findUniqueOrThrow({
    where: { websiteId_apiId: { websiteId, apiId } },
    include: { fields: true },
  });
}

async function upsertEntry(
  websiteId: string,
  contentTypeApiId: string,
  slug: string,
  fields: Record<string, unknown>,
  status: EntryStatus = EntryStatus.published,
) {
  const contentType = await prisma.contentType.findUniqueOrThrow({
    where: { websiteId_apiId: { websiteId, apiId: contentTypeApiId } },
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
        status,
        locale: "en-US",
        publishedAt: status === EntryStatus.published ? new Date() : null,
      },
    });
  } else {
    entry = await prisma.entry.update({
      where: { id: entry.id },
      data: {
        status,
        publishedAt:
          status === EntryStatus.published
            ? (entry.publishedAt ?? new Date())
            : null,
      },
    });
  }

  for (const [apiId, value] of Object.entries(fields)) {
    const def = fieldMap.get(apiId);
    if (!def) continue;
    await prisma.entryFieldValue.upsert({
      where: {
        entryId_fieldId: { entryId: entry.id, fieldId: def.id },
      },
      create: {
        entryId: entry.id,
        fieldId: def.id,
        value: value as Prisma.InputJsonValue,
      },
      update: {
        value: value as Prisma.InputJsonValue,
      },
    });
  }

  return entry;
}

async function pruneEntries(
  websiteId: string,
  contentTypeApiId: string,
  keepSlugs: string[],
) {
  const contentType = await prisma.contentType.findUnique({
    where: { websiteId_apiId: { websiteId, apiId: contentTypeApiId } },
  });
  if (!contentType) return;
  await prisma.entry.deleteMany({
    where: {
      contentTypeId: contentType.id,
      slug: { notIn: keepSlugs },
    },
  });
}

async function ensureDemoApiToken(websiteId: string, userId: string) {
  const tokenHash = createHash("sha256").update(DEMO_API_TOKEN).digest("hex");
  const prefix = DEMO_API_TOKEN.slice(0, 12);

  await prisma.apiToken.deleteMany({
    where: { websiteId, name: "Demo agent token" },
  });

  await prisma.apiToken.create({
    data: {
      websiteId,
      createdById: userId,
      name: "Demo agent token",
      tokenHash,
      prefix,
    },
  });
}

async function ensureDemoAiSettings(websiteId: string) {
  const baseUrl = process.env.CMS_AI_BASE_URL?.trim();
  const apiKey = process.env.CMS_AI_API_KEY?.trim();
  const model = process.env.CMS_AI_MODEL?.trim();
  if (!baseUrl && !apiKey && !model) return;

  const pairs: Array<{ key: string; value: string }> = [];
  if (baseUrl) pairs.push({ key: "ai.baseUrl", value: baseUrl });
  if (apiKey) pairs.push({ key: "ai.apiKey", value: apiKey });
  if (model) pairs.push({ key: "ai.model", value: model });

  for (const { key, value } of pairs) {
    await prisma.setting.upsert({
      where: { websiteId_key: { websiteId, key } },
      create: { websiteId, key, value },
      update: { value },
    });
  }
}

async function main() {
  const user = await ensureDemoUser();
  const website = await ensureDemoWebsite(user.id);
  const uid = website.id;
  await ensureDemoAiSettings(uid);
  await ensureDemoApiToken(uid, user.id);

  await ensureType(uid, "site_settings", "Site settings", "Global site configuration", [
    { apiId: "siteName", name: "Site name", type: FieldType.text, required: true, sortOrder: 0 },
    { apiId: "tagline", name: "Tagline", type: FieldType.text, sortOrder: 1 },
    { apiId: "footerText", name: "Footer text", type: FieldType.textarea, sortOrder: 2 },
    { apiId: "contactEmail", name: "Contact email", type: FieldType.text, sortOrder: 3 },
    { apiId: "contactPhone", name: "Contact phone", type: FieldType.text, sortOrder: 4 },
    { apiId: "address", name: "Address", type: FieldType.textarea, sortOrder: 5 },
    { apiId: "ctaLabel", name: "Primary CTA label", type: FieldType.text, sortOrder: 6 },
    { apiId: "ctaHref", name: "Primary CTA href", type: FieldType.text, sortOrder: 7 },
    { apiId: "socialLinkedin", name: "LinkedIn URL", type: FieldType.text, sortOrder: 8 },
    { apiId: "socialGithub", name: "GitHub URL", type: FieldType.text, sortOrder: 9 },
  ]);

  await ensureType(uid, "nav_item", "Navigation item", "Primary site navigation", [
    { apiId: "label", name: "Label", type: FieldType.text, required: true, sortOrder: 0 },
    { apiId: "href", name: "Href", type: FieldType.text, required: true, sortOrder: 1 },
    { apiId: "sortOrder", name: "Sort order", type: FieldType.number, sortOrder: 2 },
  ]);

  await ensureType(uid, "page", "Page", "Static website pages", [
    { apiId: "title", name: "Title", type: FieldType.text, required: true, sortOrder: 0 },
    { apiId: "slug", name: "Slug", type: FieldType.slug, required: true, sortOrder: 1 },
    { apiId: "eyebrow", name: "Eyebrow", type: FieldType.text, sortOrder: 2 },
    { apiId: "lead", name: "Lead", type: FieldType.textarea, sortOrder: 3 },
    { apiId: "body", name: "Body", type: FieldType.richtext, required: true, sortOrder: 4 },
    { apiId: "seoDescription", name: "SEO Description", type: FieldType.textarea, sortOrder: 5 },
    {
      apiId: "formApiId",
      name: "Form API ID",
      type: FieldType.text,
      sortOrder: 6,
    },
    {
      apiId: "ctaTitle",
      name: "CTA title",
      type: FieldType.text,
      sortOrder: 7,
    },
    {
      apiId: "ctaLead",
      name: "CTA lead",
      type: FieldType.textarea,
      sortOrder: 8,
    },
    {
      apiId: "secondaryCtaLabel",
      name: "Secondary CTA label",
      type: FieldType.text,
      sortOrder: 9,
    },
    {
      apiId: "secondaryCtaHref",
      name: "Secondary CTA href",
      type: FieldType.text,
      sortOrder: 10,
    },
  ]);

  await ensureType(uid, "author", "Author", "Blog authors", [
    { apiId: "name", name: "Name", type: FieldType.text, required: true, sortOrder: 0 },
    { apiId: "slug", name: "Slug", type: FieldType.slug, required: true, sortOrder: 1 },
    { apiId: "role", name: "Role", type: FieldType.text, sortOrder: 2 },
    { apiId: "bio", name: "Bio", type: FieldType.textarea, sortOrder: 3 },
  ]);

  await ensureType(uid, "post", "Post", "Blog posts", [
    { apiId: "title", name: "Title", type: FieldType.text, required: true, sortOrder: 0 },
    { apiId: "slug", name: "Slug", type: FieldType.slug, required: true, sortOrder: 1 },
    { apiId: "excerpt", name: "Excerpt", type: FieldType.textarea, sortOrder: 2 },
    { apiId: "body", name: "Body", type: FieldType.richtext, required: true, sortOrder: 3 },
    { apiId: "category", name: "Category", type: FieldType.text, sortOrder: 4 },
    {
      apiId: "authors",
      name: "Authors",
      type: FieldType.relations,
      sortOrder: 5,
      settings: { relatedContentTypeApiId: "author" },
    },
    { apiId: "readingMinutes", name: "Reading minutes", type: FieldType.number, sortOrder: 6 },
    { apiId: "publishedDate", name: "Published Date", type: FieldType.datetime, sortOrder: 7 },
  ]);

  // Drop legacy weak-link field if present from older seeds.
  await prisma.fieldDefinition.deleteMany({
    where: {
      apiId: "authorSlug",
      contentType: { websiteId: uid, apiId: "post" },
    },
  });

  await ensureType(uid, "service", "Service", "Services offered", [
    { apiId: "title", name: "Title", type: FieldType.text, required: true, sortOrder: 0 },
    { apiId: "slug", name: "Slug", type: FieldType.slug, required: true, sortOrder: 1 },
    { apiId: "summary", name: "Summary", type: FieldType.textarea, required: true, sortOrder: 2 },
    { apiId: "body", name: "Body", type: FieldType.richtext, required: true, sortOrder: 3 },
    { apiId: "icon", name: "Icon label", type: FieldType.text, sortOrder: 4 },
    { apiId: "sortOrder", name: "Sort order", type: FieldType.number, sortOrder: 5 },
  ]);

  await ensureType(uid, "project", "Project", "Case studies / work", [
    { apiId: "title", name: "Title", type: FieldType.text, required: true, sortOrder: 0 },
    { apiId: "slug", name: "Slug", type: FieldType.slug, required: true, sortOrder: 1 },
    { apiId: "summary", name: "Summary", type: FieldType.textarea, required: true, sortOrder: 2 },
    { apiId: "body", name: "Body", type: FieldType.richtext, required: true, sortOrder: 3 },
    { apiId: "client", name: "Client", type: FieldType.text, sortOrder: 4 },
    { apiId: "year", name: "Year", type: FieldType.text, sortOrder: 5 },
    { apiId: "tags", name: "Tags", type: FieldType.text, sortOrder: 6 },
    { apiId: "sortOrder", name: "Sort order", type: FieldType.number, sortOrder: 7 },
  ]);

  await ensureType(uid, "team_member", "Team member", "People behind Aurora", [
    { apiId: "name", name: "Name", type: FieldType.text, required: true, sortOrder: 0 },
    { apiId: "slug", name: "Slug", type: FieldType.slug, required: true, sortOrder: 1 },
    { apiId: "role", name: "Role", type: FieldType.text, required: true, sortOrder: 2 },
    { apiId: "bio", name: "Bio", type: FieldType.textarea, sortOrder: 3 },
    { apiId: "email", name: "Email", type: FieldType.text, sortOrder: 4 },
    { apiId: "sortOrder", name: "Sort order", type: FieldType.number, sortOrder: 5 },
  ]);

  await ensureType(uid, "testimonial", "Testimonial", "Customer quotes", [
    { apiId: "quote", name: "Quote", type: FieldType.textarea, required: true, sortOrder: 0 },
    { apiId: "authorName", name: "Author name", type: FieldType.text, required: true, sortOrder: 1 },
    { apiId: "authorRole", name: "Author role", type: FieldType.text, sortOrder: 2 },
    { apiId: "company", name: "Company", type: FieldType.text, sortOrder: 3 },
    { apiId: "sortOrder", name: "Sort order", type: FieldType.number, sortOrder: 4 },
  ]);

  await ensureType(uid, "faq", "FAQ", "Frequently asked questions", [
    { apiId: "question", name: "Question", type: FieldType.text, required: true, sortOrder: 0 },
    { apiId: "answer", name: "Answer", type: FieldType.richtext, required: true, sortOrder: 1 },
    { apiId: "category", name: "Category", type: FieldType.text, sortOrder: 2 },
    { apiId: "sortOrder", name: "Sort order", type: FieldType.number, sortOrder: 3 },
  ]);

  // Remove vacated vacancy module if present from earlier seeds
  await prisma.contentType.deleteMany({
    where: { websiteId: uid, apiId: "vacancy" },
  });

  await ensureForm(
    uid,
    "contact",
    {
      name: "Contact",
      description: "Product site contact form",
      submitLabel: "Send message",
      successMessage: "Thanks — we received your message and will get back soon.",
      enabled: true,
    },
    [
      {
        apiId: "name",
        label: "Name",
        type: FormFieldType.text,
        required: true,
        placeholder: "Your name",
        sortOrder: 0,
      },
      {
        apiId: "email",
        label: "Email",
        type: FormFieldType.email,
        required: true,
        placeholder: "you@example.com",
        sortOrder: 1,
      },
      {
        apiId: "message",
        label: "Message",
        type: FormFieldType.textarea,
        required: true,
        placeholder: "How can we help?",
        sortOrder: 2,
      },
      {
        apiId: "company_url",
        label: "Company URL",
        type: FormFieldType.honeypot,
        required: false,
        sortOrder: 3,
      },
    ],
  );

  // --- Entries (Aurora product site) ---
  await upsertEntry(uid, "site_settings", "default", {
    siteName: "Aurora",
    tagline: "Headless CMS for product teams",
    footerText:
      "Aurora is an open headless CMS: schema-driven content, a calm admin studio, and a public JSON API. This website is itself powered by Aurora — including the docs at /docs.",
    contactEmail: "hello@aurora.local",
    contactPhone: "+31 20 000 0000",
    address: "Built for teams who want editors unblocked and developers in control.",
    ctaLabel: "Read the docs",
    ctaHref: "/docs",
    socialLinkedin: "https://www.linkedin.com",
    socialGithub: "https://github.com",
  });

  const nav = [
    { slug: "home", label: "Product", href: "/", sortOrder: 0 },
    { slug: "docs", label: "Docs", href: "/docs", sortOrder: 1 },
    { slug: "features", label: "Features", href: "/services", sortOrder: 2 },
    { slug: "use-cases", label: "Use cases", href: "/work", sortOrder: 3 },
    { slug: "guides", label: "Guides", href: "/blog", sortOrder: 4 },
    { slug: "blogs", label: "Blogs", href: "/blogs", sortOrder: 5 },
    { slug: "pricing", label: "Pricing", href: "/pricing", sortOrder: 6 },
    { slug: "faq", label: "FAQ", href: "/faq", sortOrder: 7 },
    { slug: "about", label: "About", href: "/about", sortOrder: 8 },
    { slug: "contact", label: "Contact", href: "/contact", sortOrder: 9 },
  ];
  for (const item of nav) {
    await upsertEntry(uid, "nav_item", item.slug, item);
  }
  await pruneEntries(
    uid,
    "nav_item",
    nav.map((n) => n.slug),
  );

  await upsertEntry(uid, "page", "home", {
    title: "Ship frontends. Edit content without deploys.",
    slug: "home",
    eyebrow: "Aurora headless CMS",
    lead: "Aurora gives every account its own schema-driven CMS: an admin studio for editors, and a public API secured by a site key for your website or app.",
    body: "<p>This product site is served from Aurora’s own published entries. Open <a href=\"/docs\">/docs</a> for the full instruction set — written so an agent or developer with zero prior knowledge can build a frontend correctly.</p>",
    seoDescription:
      "Aurora — headless CMS with multi-tenant websites, public content API, and full documentation",
    ctaTitle: "Build on Aurora",
    ctaLead:
      "Read the docs, grab the demo site key, and point your frontend at the public API — or open the admin studio to edit this site live.",
    secondaryCtaLabel: "Explore features",
    secondaryCtaHref: "/services",
  });

  // Example Dutch translation of home (explicit mode — created on purpose)
  {
    const pageType = await prisma.contentType.findUniqueOrThrow({
      where: { websiteId_apiId: { websiteId: uid, apiId: "page" } },
      include: { fields: true },
    });
    const fieldMap = new Map(pageType.fields.map((f) => [f.apiId, f]));
    let nlHome = await prisma.entry.findUnique({
      where: {
        contentTypeId_slug_locale: {
          contentTypeId: pageType.id,
          slug: "home",
          locale: "nl-NL",
        },
      },
    });
    if (!nlHome) {
      nlHome = await prisma.entry.create({
        data: {
          contentTypeId: pageType.id,
          slug: "home",
          locale: "nl-NL",
          status: EntryStatus.published,
          publishedAt: new Date(),
        },
      });
    }
    const nlFields: Record<string, unknown> = {
      title: "Ship frontends. Bewerk content zonder deploys.",
      slug: "home",
      eyebrow: "Aurora headless CMS",
      lead: "Aurora geeft elk account een eigen schema-gedreven CMS: een admin studio voor editors, en een publieke API beveiligd met een site key voor je website of app.",
      body: "<p>Deze productsite komt uit Aurora’s eigen gepubliceerde entries. Open <a href=\"/docs\">/docs</a> voor de volledige instructies.</p>",
      seoDescription:
        "Aurora — headless CMS met multi-tenant websites, publieke content API en documentatie",
      ctaTitle: "Bouw op Aurora",
      ctaLead:
        "Lees de docs, pak de demo site key, en richt je frontend op de publieke API.",
      secondaryCtaLabel: "Bekijk features",
      secondaryCtaHref: "/services",
    };
    for (const [apiId, value] of Object.entries(nlFields)) {
      const def = fieldMap.get(apiId);
      if (!def) continue;
      await prisma.entryFieldValue.upsert({
        where: {
          entryId_fieldId: { entryId: nlHome.id, fieldId: def.id },
        },
        create: {
          entryId: nlHome.id,
          fieldId: def.id,
          value: value as Prisma.InputJsonValue,
        },
        update: { value: value as Prisma.InputJsonValue },
      });
    }
  }

  await upsertEntry(uid, "page", "about", {
    title: "About Aurora",
    slug: "about",
    eyebrow: "Studio + API + docs",
    lead: "Aurora is a monorepo starter: Fastify API, Prisma/Postgres, Next.js admin, and this Next.js product site.",
    body: "<p>Content types are data, not hard-coded models. Each website is an isolated tenant with its own types, entries, and AI settings. Public consumers never see drafts — only published entries behind <code>x-site-key</code>.</p><p>Start at <a href=\"/docs\">/docs</a> for authentication, the content model, and the public API cookbook.</p>",
    seoDescription: "About the Aurora headless CMS",
  });

  await upsertEntry(uid, "page", "contact", {
    title: "Get in touch",
    slug: "contact",
    eyebrow: "Contact",
    lead: "Questions about the stack, a walkthrough, or plugging Aurora into your next frontend — reach out.",
    body: "<p>Contact details and the primary CTA are managed as <code>site_settings</code> in the CMS. Prefer diving in? Open the docs and point your site key at the public API.</p>",
    seoDescription: "Contact Aurora",
    formApiId: "contact",
  });

  await upsertEntry(uid, "page", "services", {
    title: "Features",
    slug: "services",
    eyebrow: "Product",
    lead: "Each capability is a published service entry — edit them in the admin studio.",
    body: "<p>Capabilities below are the <code>service</code> collection. Reorder with sort order, publish, and they appear here and on the home page.</p>",
    seoDescription: "Aurora product features",
  });

  await upsertEntry(uid, "page", "work", {
    title: "Use cases",
    slug: "work",
    eyebrow: "How teams use Aurora",
    lead: "Scenarios are project entries — client, year, tags, and story.",
    body: "<p>Use cases are the <code>project</code> collection. Edit them in the studio to keep the marketing site current.</p>",
    seoDescription: "Aurora use cases",
  });

  await upsertEntry(uid, "page", "blog", {
    title: "Guides",
    slug: "blog",
    eyebrow: "Learn Aurora",
    lead: "Editorial guides from the CMS. For the full API instruction set, see /docs.",
    body: "<p>Guides are <code>post</code> entries with authors, categories, and reading time.</p>",
    seoDescription: "Aurora guides and journal",
  });

  await upsertEntry(uid, "page", "blogs", {
    title: "Blogs",
    slug: "blogs",
    eyebrow: "From the CMS",
    lead: "Articles from the blog content type — edit them in the admin studio.",
    body: "<p>Blog articles use the <code>blog</code> content type (title, slug, body).</p>",
    seoDescription: "Aurora blog",
  });

  await upsertEntry(uid, "page", "faq", {
    title: "FAQ",
    slug: "faq",
    eyebrow: "Help",
    lead: "Answers are FAQ entries — group them with the category field.",
    body: "<p>Add or edit questions in the <code>faq</code> collection. Categories become section headings on this page.</p>",
    seoDescription: "Aurora FAQ",
  });

  await upsertEntry(uid, "page", "team", {
    title: "Team",
    slug: "team",
    eyebrow: "People",
    lead: "Bios and roles live as team_member entries in Aurora.",
    body: "<p>Team members are a collection — name, role, bio, and optional email.</p>",
    seoDescription: "Aurora team",
  });

  await upsertEntry(uid, "page", "testimonials", {
    title: "From teams using Aurora",
    slug: "testimonials",
    eyebrow: "Social proof",
    lead: "Social proof managed as its own content type.",
    body: "<p>Testimonials appear on the home page. This page entry only supplies the section title and lead.</p>",
    seoDescription: "Aurora testimonials section",
  });

  await upsertEntry(uid, "page", "pricing", {
    title: "Variable pricing",
    slug: "pricing",
    eyebrow: "Commercial model",
    lead: "Aurora bills what you actually run: websites, people, public traffic, and AI against the provider you already pay. No fixed package that forces unused seats or unused sites.",
    body: `<p>Four independent dimensions. Turn each up or down as your portfolio grows.</p>
<h2>Per website</h2>
<p>Each Aurora website is a tenant — its own schema, content, forms, tokens, and site key. You pay for every website you create and keep active. Agencies running multiple client sites scale this dimension only; unused websites can be archived so you are not billed for idle tenants.</p>
<h2>Per seat / license</h2>
<p>People join websites through memberships with roles: editor, builder, or admin. Billing follows seats (licenses) assigned to websites. An editor who only publishes content costs a seat; builders and admins use the same seat model. One person on three websites counts as three seats — access is website-scoped, not a global org seat.</p>
<h2>Per 1,000 page views</h2>
<p>Public delivery is metered on published content served via your site key. Usage is measured in blocks of 1,000 page views on the public API for that website. Quiet marketing sites stay cheap; high-traffic launches scale this line without forcing you onto a fixed enterprise tier.</p>
<h2>AI tokens via your model provider</h2>
<p>Aurora does not resell model capacity — it runs against the provider you configure. When a website admin sets an OpenAI-compatible base URL, model, and API key, chat and content tools call that provider directly. Token cost is settled on your provider invoice. Aurora may meter studio usage for fairness, but the AI bill itself stays with the model vendor.</p>
<h2>Example shape</h2>
<p>Illustrative only — rates are agreed per contract. A studio with <strong>3 websites</strong>, <strong>8 seats</strong>, and roughly <strong>120,000 page views / month</strong> pays for 3 website units, 8 licenses, and 120 x 1,000-view blocks — plus whatever AI spend their provider account shows for studio chat and content tools.</p>
<p><a href="/contact">Contact sales</a> for a quote based on your websites, seats, and expected traffic.</p>`,
    seoDescription:
      "Aurora variable pricing: per website, per seat, per page views, AI via your model provider",
  });

  await upsertEntry(uid, "author", "mira-vale", {
    name: "Mira Vale",
    slug: "mira-vale",
    role: "Product editor",
    bio: "Writes about content models, editorial workflows, and keeping marketing unblocked.",
  });

  await upsertEntry(uid, "author", "jonas-reed", {
    name: "Jonas Reed",
    slug: "jonas-reed",
    role: "Platform engineer",
    bio: "Cares about typed APIs, tenant isolation, and boringly reliable delivery.",
  });

  await upsertEntry(uid, "post", "hello-aurora", {
    title: "Hello, Aurora",
    slug: "hello-aurora",
    excerpt:
      "This product site is powered by the same public API you will use — start here.",
    body: "Every section on aurora.local (this demo) is a published CMS entry. Edit copy in the admin studio, publish, and refresh.\n\nFor agents and developers: read /docs next. It covers site keys, FlatEntry shapes, and how to list or fetch content by type apiId and slug.",
    category: "Product",
    authors: ["mira-vale"],
    readingMinutes: 3,
    publishedDate: new Date().toISOString(),
  });

  await upsertEntry(uid, "post", "your-first-frontend", {
    title: "Your first frontend against Aurora",
    slug: "your-first-frontend",
    excerpt:
      "Five steps: site key, discover types, fetch entries, read fields, publish checklist.",
    body: "1. Set NEXT_PUBLIC_CMS_API_URL and NEXT_PUBLIC_CMS_SITE_KEY.\n2. GET /api/v1/content-types with header x-site-key.\n3. List entries with GET /api/v1/content-types/{apiId}/entries.\n4. Render entry.fields.title (and other field apiIds) — not top-level properties.\n5. Remember: drafts are invisible on the public API until you publish.\n\nFull detail: /docs/frontend-playbook and /docs/public-api.",
    category: "Guides",
    authors: ["jonas-reed"],
    readingMinutes: 6,
    publishedDate: new Date(Date.now() - 86400000).toISOString(),
  });

  await upsertEntry(uid, "post", "multi-tenant-site-keys", {
    title: "Multi-tenant site keys explained",
    slug: "multi-tenant-site-keys",
    excerpt:
      "Each login owns a CMS. Frontends authenticate with that account’s site key — never with the admin JWT.",
    body: "Registering creates an empty CMS and a unique siteKey. The seeded demo account uses demo-site-key so this product site can load published content.\n\nAdmin studio uses Bearer JWT. Public sites use x-site-key. Mixing them up is the most common integration mistake — see /docs/multi-tenancy.",
    category: "Architecture",
    authors: ["jonas-reed", "mira-vale"],
    readingMinutes: 5,
    publishedDate: new Date(Date.now() - 172800000).toISOString(),
  });

  await upsertEntry(uid, "post", "schema-driven-content", {
    title: "Why schema-driven content",
    slug: "schema-driven-content",
    excerpt:
      "Define types as data so editors can grow the model without shipping a migration for every page shape.",
    body: "Content types and field definitions live in the database. Discover them at runtime via the public content-types endpoint, then fetch entries.\n\nThis product site’s Features, Use cases, Guides, and FAQ are all separate types — the same pattern you will use in your own frontend.",
    category: "Architecture",
    authors: ["mira-vale"],
    readingMinutes: 5,
    publishedDate: new Date(Date.now() - 259200000).toISOString(),
  });

  const services = [
    {
      slug: "schema-studio",
      title: "Schema-driven studio",
      summary:
        "Define content types and fields in the admin — no hard-coded page models required.",
      body: "Editors work in a focused studio: types, entries, publish. The public API exposes only published flat JSON. Extend the model as the product grows.",
      icon: "01",
      sortOrder: 0,
    },
    {
      slug: "public-content-api",
      title: "Public content API",
      summary:
        "Read published content with x-site-key. Discover types, list entries, fetch by slug.",
      body: "Endpoints under /api/v1/content-types are tenant-scoped by site key. Perfect for Next.js, mobile apps, or any HTTP client. Full reference: /docs/public-api.",
      icon: "02",
      sortOrder: 1,
    },
    {
      slug: "multi-tenant-accounts",
      title: "Multi-tenant accounts",
      summary:
        "Every login is an isolated CMS. New accounts start empty; the demo tenant ships with this product site.",
      body: "JWT for admin, site key for public read. AI settings are per account too — never shared via env at runtime.",
      icon: "03",
      sortOrder: 2,
    },
    {
      slug: "ai-assisted-editing",
      title: "AI-assisted editing",
      summary:
        "Optional OpenAI-compatible operator in admin for types, entries, and copy patches.",
      body: "Configure a provider per account under Admin → AI. Versions snapshot entries before AI edits so you can restore safely.",
      icon: "04",
      sortOrder: 3,
    },
  ];
  for (const s of services) {
    await upsertEntry(uid, "service", s.slug, s);
  }
  await pruneEntries(
    uid,
    "service",
    services.map((s) => s.slug),
  );

  const projects = [
    {
      slug: "product-marketing-site",
      title: "Product marketing site",
      summary:
        "This Aurora website: home, features, guides, FAQ — all from published CMS entries plus /docs.",
      body: "Use site_settings and nav_item for chrome, page for landings, and collections for features and guides. Documentation lives in repo markdown and is served at /docs for agents and developers.",
      client: "Aurora",
      year: "2026",
      tags: "Marketing, Docs",
      sortOrder: 0,
    },
    {
      slug: "headless-docs-portal",
      title: "Headless docs portal",
      summary:
        "Pair CMS guides (post) with filesystem docs for deep API reference.",
      body: "Editorial guides stay editable in the studio. Canonical API instructions stay in versioned markdown so agents get exact, reviewable specs.",
      client: "Platform teams",
      year: "2026",
      tags: "Docs, API",
      sortOrder: 1,
    },
    {
      slug: "multi-brand-frontends",
      title: "Multi-brand frontends",
      summary:
        "One Aurora deploy, many site keys — each brand gets its own content graph.",
      body: "Point each frontend at its account site key. No shared content leakage between tenants.",
      client: "Agencies",
      year: "2026",
      tags: "Multi-tenant",
      sortOrder: 2,
    },
  ];
  for (const p of projects) {
    await upsertEntry(uid, "project", p.slug, p);
  }
  await pruneEntries(
    uid,
    "project",
    projects.map((p) => p.slug),
  );

  const team = [
    {
      slug: "ada-klein",
      name: "Ada Klein",
      role: "Founder / Product",
      bio: "Sets the editorial north star and keeps the schema honest.",
      email: "ada@aurora.local",
      sortOrder: 0,
    },
    {
      slug: "samir-okonkwo",
      name: "Samir Okonkwo",
      role: "Engineering",
      bio: "Owns the API surface, tenant auth, and reliability.",
      email: "samir@aurora.local",
      sortOrder: 1,
    },
    {
      slug: "elena-berg",
      name: "Elena Berg",
      role: "Design",
      bio: "Shapes the studio and product site with restraint.",
      email: "elena@aurora.local",
      sortOrder: 2,
    },
    {
      slug: "noah-pires",
      name: "Noah Pires",
      role: "Developer experience",
      bio: "Writes docs so agents and humans integrate without guesswork.",
      email: "noah@aurora.local",
      sortOrder: 3,
    },
  ];
  for (const m of team) {
    await upsertEntry(uid, "team_member", m.slug, m);
  }
  await pruneEntries(
    uid,
    "team_member",
    team.map((m) => m.slug),
  );

  const testimonials = [
    {
      slug: "t-editors",
      quote:
        "We stopped treating every copy change like a release. Marketing moves; engineering keeps the craft.",
      authorName: "Leah Ort",
      authorRole: "VP Marketing",
      company: "Product org",
      sortOrder: 0,
    },
    {
      slug: "t-platform",
      quote:
        "Site keys per account made multi-brand delivery boring — in the best way.",
      authorName: "Chris Nguyen",
      authorRole: "Head of Platform",
      company: "Agency group",
      sortOrder: 1,
    },
    {
      slug: "t-dx",
      quote:
        "The /docs pack meant our coding agent built the frontend against the real API on the first try.",
      authorName: "Ines Duarte",
      authorRole: "Staff engineer",
      company: "DX team",
      sortOrder: 2,
    },
  ];
  for (const t of testimonials) {
    await upsertEntry(uid, "testimonial", t.slug, t);
  }
  await pruneEntries(
    uid,
    "testimonial",
    testimonials.map((t) => t.slug),
  );

  const faqs = [
    {
      slug: "what-is-aurora",
      question: "What is Aurora?",
      answer:
        "A headless CMS: schema-driven content types, an admin studio, and a public JSON API for published entries. This website is the product site and is itself powered by Aurora.",
      category: "General",
      sortOrder: 0,
    },
    {
      slug: "where-are-docs",
      question: "Where is the full documentation?",
      answer:
        "On this site at /docs, and in the repo docs/ folder. Start with Overview, then Multi-tenancy, Content model, and Public API.",
      category: "Developers",
      sortOrder: 1,
    },
    {
      slug: "how-public-api",
      question: "How do I fetch content for a frontend?",
      answer:
        "Send header x-site-key with your account site key. List types, then list or get entries by type apiId and slug. Only published entries are returned. See /docs/public-api.",
      category: "Developers",
      sortOrder: 2,
    },
    {
      slug: "is-there-auth",
      question: "How does authentication work?",
      answer:
        "Admin requires login (JWT). Each account owns its content and AI settings. Public sites use that account’s site key (x-site-key). Never put the admin JWT in a public frontend.",
      category: "Security",
      sortOrder: 3,
    },
    {
      slug: "drafts-public",
      question: "Are drafts visible on the website?",
      answer:
        "No. Public routes only return published entries. Drafts stay in the admin until you publish.",
      category: "Editorial",
      sortOrder: 4,
    },
    {
      slug: "empty-account",
      question: "Why is a new account empty?",
      answer:
        "By design. Register creates an isolated empty CMS. The demo tenant (demo-site-key) is seeded with this product site’s content.",
      category: "General",
      sortOrder: 5,
    },
    {
      slug: "can-agents-write",
      question: "Can a site-building agent create content types and content?",
      answer:
        "Yes. Use the Management API with a Bearer API token (aur_…) or login JWT. Prefer POST /api/v1/admin/provision to upsert types, fields, and entries in one call. See /docs/management-api. Never put management tokens in a public frontend — use x-site-key for read-only delivery.",
      category: "Developers",
      sortOrder: 6,
    },
  ];
  for (const f of faqs) {
    await upsertEntry(uid, "faq", f.slug, f);
  }
  await pruneEntries(
    uid,
    "faq",
    faqs.map((f) => f.slug),
  );

  await pruneEntries(uid, "post", [
    "hello-aurora",
    "your-first-frontend",
    "multi-tenant-site-keys",
    "schema-driven-content",
  ]);

  const { seedDocsForWebsite } = await import("./seed-docs.js");
  const docCount = await seedDocsForWebsite(uid);
  console.log(`Seeded ${docCount} documentation entries (content type doc).`);

  console.log(
    `Seed completed for ${DEMO_EMAIL} (password: ${DEMO_PASSWORD}, siteKey: ${DEMO_SITE_KEY}, apiToken: ${DEMO_API_TOKEN}).`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
