import type { Metadata } from "next";
import type { FlatEntry } from "@cms/shared";
import { RichTextBody } from "@/components/RichTextBody";
import { fieldString, getEntry, plainTextExcerpt } from "@/lib/cms";

export async function getCmsPage(slug: string): Promise<FlatEntry | null> {
  return getEntry("page", slug);
}

export async function cmsPageMetadata(
  slug: string,
  fallbackTitle: string,
): Promise<Metadata> {
  const page = await getCmsPage(slug);
  return {
    title: page ? fieldString(page, "title", fallbackTitle) : fallbackTitle,
    description: page
      ? fieldString(page, "seoDescription") || undefined
      : undefined,
  };
}

export function CmsPageHero({
  page,
  fallbackTitle,
  fallbackLead = "",
}: {
  page: FlatEntry | null;
  fallbackTitle: string;
  fallbackLead?: string;
}) {
  const title = page ? fieldString(page, "title", fallbackTitle) : fallbackTitle;
  const eyebrow = page ? fieldString(page, "eyebrow") : "";
  const lead = page
    ? fieldString(page, "lead") || plainTextExcerpt(fieldString(page, "body"))
    : fallbackLead;

  return (
    <header className="page-hero">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1>{title}</h1>
      {lead ? <p>{lead}</p> : null}
    </header>
  );
}

export function CmsPageBody({ page }: { page: FlatEntry | null }) {
  if (!page) return null;
  const body = fieldString(page, "body");
  if (!body.trim()) return null;
  return (
    <article className="prose" style={{ marginBottom: "2rem" }}>
      <RichTextBody value={body} />
    </article>
  );
}
