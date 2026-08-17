import { Prisma } from "@prisma/client";
import type { ListEntriesOrder, ListEntriesSort } from "@cms/shared";
import { prisma } from "../db.js";
import { entryInclude } from "./entries.js";
import {
  fieldFilterSqlExists,
  fieldFilterToPrismaSome,
  type ListFieldFilter,
} from "./listEntriesFieldFilter.js";

type ListWhere = {
  contentTypeId: string;
  status?: "published" | "draft";
  slug?: string | { contains: string; mode: "insensitive" };
  locale?: string;
};

/**
 * List entries with timestamp or fields.sortOrder ordering.
 * sortOrder uses the field definition with apiId "sortOrder" when present.
 * Optional fieldFilter restricts to entries whose named field matches any of the values (IN).
 */
export async function listEntriesOrdered(options: {
  where: ListWhere;
  sort: ListEntriesSort;
  order: ListEntriesOrder;
  limit: number;
  offset: number;
  /** Field id of the number field apiId=sortOrder, if any */
  sortOrderFieldId?: string | null;
  fieldFilter?: ListFieldFilter | null;
}) {
  const { where, sort, order, limit, offset, sortOrderFieldId, fieldFilter } =
    options;

  const prismaWhere: Prisma.EntryWhereInput = {
    ...where,
    ...(fieldFilter
      ? { fieldValues: fieldFilterToPrismaSome(fieldFilter) }
      : {}),
  };

  if (sort === "sortOrder" && sortOrderFieldId) {
    const dir = order === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const statusFilter = where.status
      ? Prisma.sql`AND e.status = ${where.status}::"EntryStatus"`
      : Prisma.empty;
    const slugFilter =
      typeof where.slug === "string"
        ? Prisma.sql`AND e.slug = ${where.slug}`
        : where.slug && "contains" in where.slug
          ? Prisma.sql`AND e.slug ILIKE ${"%" + where.slug.contains + "%"}`
          : Prisma.empty;
    const localeFilter = where.locale
      ? Prisma.sql`AND e.locale = ${where.locale}`
      : Prisma.empty;
    const fieldSql = fieldFilter ? fieldFilterSqlExists(fieldFilter) : Prisma.empty;

    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT e.id
      FROM "Entry" e
      LEFT JOIN "EntryFieldValue" v
        ON v."entryId" = e.id AND v."fieldId" = ${sortOrderFieldId}
      WHERE e."contentTypeId" = ${where.contentTypeId}
        ${statusFilter}
        ${slugFilter}
        ${localeFilter}
        ${fieldSql}
      ORDER BY
        CASE
          WHEN jsonb_typeof(v.value) = 'number' THEN (v.value)::numeric
          WHEN jsonb_typeof(v.value) = 'string'
            AND (v.value #>> '{}') ~ '^-?[0-9]+(\\.[0-9]+)?$'
            THEN (v.value #>> '{}')::numeric
          ELSE NULL
        END ${dir} NULLS LAST,
        e."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const ids = rows.map((r) => r.id);
    if (ids.length === 0) {
      const total = await prisma.entry.count({ where: prismaWhere });
      return { items: [], total };
    }

    const items = await prisma.entry.findMany({
      where: { id: { in: ids } },
      include: entryInclude,
    });
    const byId = new Map(items.map((e) => [e.id, e]));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
    const total = await prisma.entry.count({ where: prismaWhere });
    return { items: ordered, total };
  }

  const orderBy =
    sort === "slug"
      ? ([{ slug: order }, { locale: "asc" as const }] as const)
      : sort === "createdAt"
        ? ([{ createdAt: order }] as const)
        : sort === "updatedAt"
          ? ([{ updatedAt: order }] as const)
          : sort === "sortOrder"
            ? // No sortOrder field on type — fall back to publishedAt
              ([
                { publishedAt: "desc" as const },
                { createdAt: "desc" as const },
              ] as const)
            : ([
                { publishedAt: order },
                { createdAt: order },
              ] as const);

  const [items, total] = await Promise.all([
    prisma.entry.findMany({
      where: prismaWhere,
      include: entryInclude,
      orderBy: [...orderBy],
      take: limit,
      skip: offset,
    }),
    prisma.entry.count({ where: prismaWhere }),
  ]);

  return { items, total };
}
