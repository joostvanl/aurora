import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CmsForm } from "@/components/CmsForm";
import { RichTextBody } from "@/components/RichTextBody";
import { fieldString, getEntry } from "@/lib/cms";

export const dynamic = "force-dynamic";

const RESERVED = new Set([
  "blog",
  "blogs",
  "services",
  "work",
  "team",
  "faq",
  "contact",
  "about",
  "docs",
  "pricing",
]);

function isAssetLikeSlug(slug: string) {
  return slug.includes(".") || slug.startsWith("_");
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (RESERVED.has(slug) || isAssetLikeSlug(slug)) return { title: slug };
  const page = await getEntry("page", slug);
  if (!page) return { title: slug };
  return {
    title: fieldString(page, "title", slug),
    description: fieldString(page, "seoDescription") || undefined,
  };
}

export default async function PageBySlug({ params }: Props) {
  const { slug } = await params;
  if (RESERVED.has(slug) || isAssetLikeSlug(slug)) notFound();

  const page = await getEntry("page", slug);
  if (!page) notFound();

  const formApiId = fieldString(page, "formApiId");

  return (
    <article className="prose">
      {fieldString(page, "eyebrow") && (
        <p className="eyebrow">{fieldString(page, "eyebrow")}</p>
      )}
      <h1>{fieldString(page, "title", slug)}</h1>
      {fieldString(page, "lead") && (
        <p className="lead">{fieldString(page, "lead")}</p>
      )}
      <RichTextBody value={fieldString(page, "body")} />
      {formApiId ? (
        <div style={{ marginTop: "2rem" }}>
          <CmsForm apiId={formApiId} />
        </div>
      ) : null}
    </article>
  );
}
