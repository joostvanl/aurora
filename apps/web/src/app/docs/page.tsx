import type { Metadata } from "next";
import { DocsNav, DocsPager } from "@/components/DocsNav";
import { MarkdownDoc } from "@/components/MarkdownDoc";
import { getDocMeta, readDocMarkdown, rewriteDocLinks } from "@/lib/docs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Full Aurora CMS instructions for developers and agents building frontends",
};

export default async function DocsIndexPage() {
  const meta = getDocMeta("readme")!;
  const raw = (await readDocMarkdown("readme")) ?? "# Docs missing\n\nCould not load docs/README.md.";
  const source = rewriteDocLinks(raw);

  return (
    <div className="docs-layout">
      <DocsNav active="readme" />
      <div className="docs-content">
        <p className="eyebrow">Aurora docs</p>
        <MarkdownDoc source={source} />
        <DocsPager current={meta} />
      </div>
    </div>
  );
}
