import { describeLocales, isLocaleCode, LocaleCodeSchema } from "@cms/shared";
import { prisma } from "../db.js";
import { httpError } from "./httpError.js";

export function assertLocaleOnWebsite(
  locale: string,
  website: { locales: string[]; defaultLocale: string },
) {
  if (!isLocaleCode(locale)) {
    throw httpError(
      400,
      `Invalid locale "${locale}" — use language-REGION (e.g. en-US)`,
      "VALIDATION_FAILED",
    );
  }
  if (!website.locales.includes(locale)) {
    throw httpError(
      400,
      `Locale "${locale}" is not enabled for this website`,
      "LOCALE_NOT_ENABLED",
    );
  }
}

export async function getWebsiteLocales(websiteId: string) {
  return prisma.website.findUniqueOrThrow({
    where: { id: websiteId },
    select: { locales: true, defaultLocale: true },
  });
}

export function resolvePublicLocale(
  queryLocale: string | undefined,
  website: { locales: string[]; defaultLocale: string },
): string {
  const locale = queryLocale ?? website.defaultLocale;
  assertLocaleOnWebsite(locale, website);
  return locale;
}

export function publicLocalesPayload(website: {
  locales: string[];
  defaultLocale: string;
}) {
  return {
    defaultLocale: website.defaultLocale,
    locales: describeLocales(website.locales),
  };
}

export function normalizeWebsiteLocalesInput(input: {
  locales?: string[];
  defaultLocale?: string;
  current: { locales: string[]; defaultLocale: string };
}): { locales: string[]; defaultLocale: string } {
  const locales = input.locales ?? input.current.locales;
  const defaultLocale = input.defaultLocale ?? input.current.defaultLocale;

  const unique = [...new Set(locales)];
  if (unique.length === 0) {
    throw httpError(400, "At least one locale is required", "VALIDATION_FAILED");
  }
  for (const code of unique) {
    const parsed = LocaleCodeSchema.safeParse(code);
    if (!parsed.success) {
      throw httpError(
        400,
        `Invalid locale "${code}" — use language-REGION (e.g. en-US)`,
        "VALIDATION_FAILED",
      );
    }
  }
  if (!unique.includes(defaultLocale)) {
    throw httpError(
      400,
      "defaultLocale must be included in locales",
      "VALIDATION_FAILED",
    );
  }
  return { locales: unique, defaultLocale };
}

/** Block removing a locale that still has entries on this website. */
export async function assertLocalesRemovable(
  websiteId: string,
  nextLocales: string[],
  currentLocales: string[],
) {
  const removed = currentLocales.filter((l) => !nextLocales.includes(l));
  if (removed.length === 0) return;

  const count = await prisma.entry.count({
    where: {
      locale: { in: removed },
      contentType: { websiteId },
    },
  });
  if (count > 0) {
    throw httpError(
      409,
      `Cannot remove locale(s) ${removed.join(", ")}: ${count} entr${count === 1 ? "y" : "ies"} still use them`,
      "LOCALE_IN_USE",
    );
  }
}
