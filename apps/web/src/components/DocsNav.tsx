import Link from "next/link";
import {
  docsBySlug,
  listNavDocs,
  rootNavSlug,
  type DocMeta,
} from "@/lib/docs";

function docHref(slug: string) {
  return slug === "readme" ? "/docs" : `/docs/${slug}`;
}

export function DocsNav({
  active,
  catalog,
}: {
  active?: string;
  catalog: DocMeta[];
}) {
  const navDocs = listNavDocs(catalog);
  const bySlug = docsBySlug(catalog);
  const activeRoot =
    active && bySlug.has(active)
      ? rootNavSlug(bySlug.get(active)!, bySlug)
      : active;

  return (
    <aside className="docs-nav">
      <div className="docs-nav-title">Documentation</div>
      <nav>
        <div className="docs-nav-group">
          {navDocs.map((doc) => (
            <Link
              key={doc.slug}
              href={docHref(doc.slug)}
              className={activeRoot === doc.slug ? "is-active" : undefined}
            >
              <span>{doc.title}</span>
              <small>{doc.description}</small>
            </Link>
          ))}
        </div>
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
  const sorted = listNavDocs(catalog);
  const idx = sorted.findIndex((d) => d.slug === current.slug);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

  if (idx < 0 && current.parentSlug) {
    const parent =
      catalog.find((d) => d.slug === current.parentSlug) ?? null;
    return (
      <div className="docs-pager">
        {parent ? (
          <Link href={docHref(parent.slug)}>← {parent.title}</Link>
        ) : (
          <span />
        )}
        <span />
      </div>
    );
  }

  return (
    <div className="docs-pager">
      {prev ? (
        <Link href={docHref(prev.slug)}>← {prev.title}</Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link href={docHref(next.slug)}>{next.title} →</Link>
      ) : (
        <span />
      )}
    </div>
  );
}
