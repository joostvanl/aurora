import type { Metadata } from "next";
import Link from "next/link";
import {
  CmsPageBody,
  CmsPageHero,
  cmsPageMetadata,
  getCmsPage,
} from "@/components/CmsPage";
import { fieldNumber, fieldString, listType } from "@/lib/cms";

export const dynamic = "force-dynamic";

export function generateMetadata(): Promise<Metadata> {
  return cmsPageMetadata("blog", "Guides");
}

export default async function BlogIndexPage() {
  const [page, posts] = await Promise.all([
    getCmsPage("blog"),
    listType("post"),
  ]);

  const ordered = posts.slice().sort((a, b) => {
    const da =
      typeof a.fields.publishedDate === "string"
        ? Date.parse(a.fields.publishedDate)
        : Date.parse(a.publishedAt ?? "") || 0;
    const db =
      typeof b.fields.publishedDate === "string"
        ? Date.parse(b.fields.publishedDate)
        : Date.parse(b.publishedAt ?? "") || 0;
    return db - da;
  });

  return (
    <>
      <CmsPageHero
        page={page}
        fallbackTitle="Guides"
        fallbackLead="Editorial guides from the CMS."
      />
      <CmsPageBody page={page} />
      <div>
        {ordered.map((post) => {
          const date =
            typeof post.fields.publishedDate === "string"
              ? post.fields.publishedDate
              : post.publishedAt;
          const minutes = fieldNumber(post, "readingMinutes");
          return (
            <Link
              className="list-link"
              key={post.id}
              href={`/blog/${post.slug}`}
            >
              <div className="meta">
                <span className="tag">
                  {fieldString(post, "category", "Note")}
                </span>
                {date
                  ? ` · ${new Date(date).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}`
                  : ""}
                {minutes ? ` · ${minutes} min` : ""}
              </div>
              <h3>{fieldString(post, "title", post.slug)}</h3>
              {fieldString(post, "excerpt") && (
                <p>{fieldString(post, "excerpt")}</p>
              )}
            </Link>
          );
        })}
        {ordered.length === 0 && (
          <div className="empty">No posts published yet.</div>
        )}
      </div>
    </>
  );
}
