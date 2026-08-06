import type { Metadata } from "next";
import { DocsNav, DocsPager } from "@/components/DocsNav";
import { MarkdownDoc } from "@/components/MarkdownDoc";
import { getDoc, listDocs } from "@/lib/docs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Full Aurora CMS instructions for developers and agents building frontends",
};

export default async function DocsIndexPage() {
  const [catalog, doc] = await Promise.all([listDocs(), getDoc("readme")]);
  const source =
    doc?.body ??
    "# Docs missing\n\nPublish a `doc` entry with slug `readme` in the CMS.";
  const meta = doc ?? {
    slug: "readme",
    title: "Start here",
    description: "",
    order: 0,
    parentSlug: null,
  };

  return (
    <div className="docs-layout">
      <DocsNav active="readme" catalog={catalog} />
      <div className="docs-content">
        <p className="eyebrow">Aurora docs</p>
        <MarkdownDoc source={source} />
        <DocsPager current={meta} catalog={catalog} />
      </div>
    </div>
  );
}
