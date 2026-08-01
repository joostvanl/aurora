import Link from "next/link";
import { DOC_CATALOG, type DocMeta } from "@/lib/docs";

export function DocsNav({ active }: { active?: string }) {
  return (
    <aside className="docs-nav">
      <div className="docs-nav-title">Documentation</div>
      <nav>
        {DOC_CATALOG.map((doc) => (
          <Link
            key={doc.slug}
            href={doc.slug === "readme" ? "/docs" : `/docs/${doc.slug}`}
            className={active === doc.slug ? "is-active" : undefined}
          >
            <span>{doc.title}</span>
            <small>{doc.description}</small>
          </Link>
        ))}
      </nav>
    </aside>
  );
}

export function DocsPager({ current }: { current: DocMeta }) {
  const idx = DOC_CATALOG.findIndex((d) => d.slug === current.slug);
  const prev = idx > 0 ? DOC_CATALOG[idx - 1] : null;
  const next = idx >= 0 && idx < DOC_CATALOG.length - 1 ? DOC_CATALOG[idx + 1] : null;

  return (
    <div className="docs-pager">
      {prev ? (
        <Link href={prev.slug === "readme" ? "/docs" : `/docs/${prev.slug}`}>
          ← {prev.title}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={next.slug === "readme" ? "/docs" : `/docs/${next.slug}`}>
          {next.title} →
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}
