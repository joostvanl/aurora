import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsNav, DocsPager } from "@/components/DocsNav";
import { MarkdownDoc } from "@/components/MarkdownDoc";
import { getDoc, listDocs } from "@/lib/docs";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = await getDoc(slug);
  return {
    title: doc?.title ?? "Docs",
    description: doc?.description,
  };
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (slug === "readme") notFound();

  const [catalog, doc] = await Promise.all([listDocs(), getDoc(slug)]);
  if (!doc) notFound();

  return (
    <div className="docs-layout">
      <DocsNav active={slug} catalog={catalog} />
      <div className="docs-content">
        <p className="eyebrow">Aurora docs</p>
        <MarkdownDoc source={doc.body} />
        <DocsPager current={doc} catalog={catalog} />
      </div>
    </div>
  );
}
