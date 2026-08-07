import { EntryStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { entryInclude, setEntryFields } from "./entries.js";
import { httpError } from "./httpError.js";
import { assertLocaleOnWebsite } from "./locales.js";
import { serializeEntry } from "./serialize.js";

async function copyFieldValues(
  sourceEntryId: string,
  targetEntryId: string,
  contentTypeId: string,
  websiteId: string,
  locale: string,
) {
  const source = await prisma.entry.findUniqueOrThrow({
    where: { id: sourceEntryId },
    include: { fieldValues: { include: { field: true } } },
  });
  const fields: Record<string, unknown> = {};
  for (const fv of source.fieldValues) {
    fields[fv.field.apiId] = fv.value;
  }
  await setEntryFields(targetEntryId, contentTypeId, fields, websiteId, locale);
}

export async function createTranslationFromEntry(options: {
  websiteId: string;
  contentTypeId: string;
  sourceEntryId: string;
  locale: string;
  website: { locales: string[]; defaultLocale: string };
  createdByUserId?: string | null;
}) {
  assertLocaleOnWebsite(options.locale, options.website);

  const source = await prisma.entry.findFirst({
    where: {
      id: options.sourceEntryId,
      contentTypeId: options.contentTypeId,
    },
  });
  if (!source) {
    throw httpError(404, "Entry not found", "ENTRY_NOT_FOUND");
  }

  const existing = await prisma.entry.findUnique({
    where: {
      contentTypeId_slug_locale: {
        contentTypeId: options.contentTypeId,
        slug: source.slug,
        locale: options.locale,
      },
    },
  });
  if (existing) {
    throw httpError(
      409,
      `Translation for locale "${options.locale}" already exists`,
      "TRANSLATION_EXISTS",
    );
  }

  const created = await prisma.entry.create({
    data: {
      contentTypeId: options.contentTypeId,
      slug: source.slug,
      locale: options.locale,
      status: EntryStatus.draft,
      publishedAt: null,
      ...(options.createdByUserId
        ? { createdByUserId: options.createdByUserId }
        : {}),
    },
  });

  await copyFieldValues(
    source.id,
    created.id,
    options.contentTypeId,
    options.websiteId,
    options.locale,
  );

  const full = await prisma.entry.findUniqueOrThrow({
    where: { id: created.id },
    include: entryInclude,
  });
  return serializeEntry(full);
}

/** For all_locales mode: create draft siblings for every other site locale. */
export async function createAllLocaleSiblings(options: {
  websiteId: string;
  contentTypeId: string;
  sourceEntryId: string;
  sourceLocale: string;
  locales: string[];
  createdByUserId?: string | null;
}) {
  const siblings = [];
  for (const locale of options.locales) {
    if (locale === options.sourceLocale) continue;
    const existing = await prisma.entry.findUnique({
      where: {
        contentTypeId_slug_locale: {
          contentTypeId: options.contentTypeId,
          slug: (
            await prisma.entry.findUniqueOrThrow({
              where: { id: options.sourceEntryId },
              select: { slug: true },
            })
          ).slug,
          locale,
        },
      },
    });
    if (existing) continue;

    const source = await prisma.entry.findUniqueOrThrow({
      where: { id: options.sourceEntryId },
    });

    const created = await prisma.entry.create({
      data: {
        contentTypeId: options.contentTypeId,
        slug: source.slug,
        locale,
        status: EntryStatus.draft,
        publishedAt: null,
        ...(options.createdByUserId
          ? { createdByUserId: options.createdByUserId }
          : {}),
      },
    });
    await copyFieldValues(
      source.id,
      created.id,
      options.contentTypeId,
      options.websiteId,
      locale,
    );
    const full = await prisma.entry.findUniqueOrThrow({
      where: { id: created.id },
      include: entryInclude,
    });
    siblings.push(serializeEntry(full));
  }
  return siblings;
}

/** Create missing locale stubs for every slug that has at least one entry. */
export async function syncMissingLocalesForType(options: {
  websiteId: string;
  contentTypeId: string;
  locales: string[];
  dryRun?: boolean;
  createdByUserId?: string | null;
}) {
  const entries = await prisma.entry.findMany({
    where: { contentTypeId: options.contentTypeId },
    select: { id: true, slug: true, locale: true },
    orderBy: { createdAt: "asc" },
  });

  const bySlug = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = bySlug.get(e.slug) ?? [];
    list.push(e);
    bySlug.set(e.slug, list);
  }

  const missing: Array<{ slug: string; locale: string; sourceEntryId: string }> =
    [];
  for (const [slug, versions] of bySlug) {
    const present = new Set(versions.map((v) => v.locale));
    const source = versions[0]!;
    for (const locale of options.locales) {
      if (!present.has(locale)) {
        missing.push({ slug, locale, sourceEntryId: source.id });
      }
    }
  }

  if (options.dryRun) {
    return { missing, created: [] as ReturnType<typeof serializeEntry>[] };
  }

  const created = [];
  for (const item of missing) {
    const entry = await prisma.entry.create({
      data: {
        contentTypeId: options.contentTypeId,
        slug: item.slug,
        locale: item.locale,
        status: EntryStatus.draft,
        publishedAt: null,
        ...(options.createdByUserId
          ? { createdByUserId: options.createdByUserId }
          : {}),
      },
    });
    await copyFieldValues(
      item.sourceEntryId,
      entry.id,
      options.contentTypeId,
      options.websiteId,
      item.locale,
    );
    const full = await prisma.entry.findUniqueOrThrow({
      where: { id: entry.id },
      include: entryInclude,
    });
    created.push(serializeEntry(full));
  }

  return { missing, created };
}
