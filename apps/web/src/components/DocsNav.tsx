import Link from "next/link";
import { groupDocsByChapter, listNavDocs, type DocMeta } from "@/lib/docs";

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
  const groups = groupDocsByChapter(catalog);

  return (
    <aside className="docs-nav">
      <div className="docs-nav-title">Documentation</div>
      <nav>
        {groups.map((group) => (
          <div
            key={group.chapter || "__root"}
            className="docs-nav-group"
          >
            {group.chapter && group.docs.length > 1 ? (
              <div className="docs-nav-chapter">{group.chapter}</div>
            ) : null}
            {group.docs.map((doc) => {
              const isActive =
                active === doc.slug ||
                (doc.slug === "integrations" &&
                  (active === "public-api" ||
                    active === "management-api" ||
                    active === "admin-api" ||
                    active === "mcp" ||
                    active === "typed-client" ||
                    catalog.some(
                      (d) =>
                        d.slug === active && d.chapter === "Integrations",
                    )));
              return (
                <Link
                  key={doc.slug}
                  href={docHref(doc.slug)}
                  className={isActive ? "is-active" : undefined}
                >
                  <span>{doc.title}</span>
                  <small>{doc.description}</small>
                </Link>
              );
            })}
          </div>
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
  // Prev/next follow the sidebar (skip Integration subpages).
  const sorted = listNavDocs(catalog);
  const idx = sorted.findIndex((d) => d.slug === current.slug);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

  // On a hidden integration subpage, link back to the Integrations landing.
  if (idx < 0) {
    const landing = catalog.find((d) => d.slug === "integrations");
    const isHiddenIntegration =
      current.chapter === "Integrations" ||
      ["public-api", "management-api", "admin-api", "mcp"].includes(
        current.slug,
      );
    if (isHiddenIntegration && landing) {
      return (
        <div className="docs-pager">
          <Link href={docHref(landing.slug)}>← {landing.title}</Link>
          <span />
        </div>
      );
    }
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
