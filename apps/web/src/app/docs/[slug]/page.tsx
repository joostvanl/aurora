import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsNav, DocsPager } from "@/components/DocsNav";
import { MarkdownDoc } from "@/components/MarkdownDoc";
import {
  DOC_CATALOG,
  getDocMeta,
  readDocMarkdown,
  rewriteDocLinks,
} from "@/lib/docs";

export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return DOC_CATALOG.filter((d) => d.slug !== "readme").map((d) => ({
    slug: d.slug,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const meta = getDocMeta(slug);
  return {
    title: meta?.title ?? "Docs",
    description: meta?.description,
  };
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (slug === "readme") notFound();
  const meta = getDocMeta(slug);
  if (!meta) notFound();

  const raw = await readDocMarkdown(slug);
  if (!raw) notFound();

  return (
    <div className="docs-layout">
      <DocsNav active={slug} />
      <div className="docs-content">
        <p className="eyebrow">Aurora docs</p>
        <MarkdownDoc source={rewriteDocLinks(raw)} />
        <DocsPager current={meta} />
      </div>
    </div>
  );
}
