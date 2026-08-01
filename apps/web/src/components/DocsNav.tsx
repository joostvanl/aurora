import Link from "next/link";
import type { DocMeta } from "@/lib/docs";

export function DocsNav({
  active,
  catalog,
}: {
  active?: string;
  catalog: DocMeta[];
}) {
  return (
    <aside className="docs-nav">
      <div className="docs-nav-title">Documentation</div>
      <nav>
        {catalog.map((doc) => (
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

export function DocsPager({
  current,
  catalog,
}: {
  current: DocMeta;
  catalog: DocMeta[];
}) {
  const idx = catalog.findIndex((d) => d.slug === current.slug);
  const prev = idx > 0 ? catalog[idx - 1] : null;
  const next = idx >= 0 && idx < catalog.length - 1 ? catalog[idx + 1] : null;

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
