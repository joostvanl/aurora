import type { Metadata } from "next";
import Link from "next/link";
import {
  CmsPageBody,
  CmsPageHero,
  cmsPageMetadata,
  getCmsPage,
} from "@/components/CmsPage";
import {
  fieldMedia,
  fieldString,
  listType,
  plainTextWordTeaser,
} from "@/lib/cms";

export const dynamic = "force-dynamic";

export function generateMetadata(): Promise<Metadata> {
  return cmsPageMetadata("blogs", "Blogs");
}

export default async function BlogsIndexPage() {
  const [page, posts] = await Promise.all([
    getCmsPage("blogs"),
    listType("blog"),
  ]);

  const ordered = posts.slice().sort((a, b) => {
    const da = Date.parse(a.publishedAt ?? a.createdAt) || 0;
    const db = Date.parse(b.publishedAt ?? b.createdAt) || 0;
    return db - da;
  });

  return (
    <>
      <CmsPageHero
        page={page}
        fallbackTitle="Blogs"
        fallbackLead="Articles from the blog content type."
      />
      <CmsPageBody page={page} />
      <div className="blog-grid">
        {ordered.map((post) => {
          const date = post.publishedAt ?? post.createdAt;
          const teaser = plainTextWordTeaser(fieldString(post, "body"), 20);
          const image = fieldMedia(post, "image");
          const title = fieldString(post, "title", post.slug);
          const imageAlt = image?.alt?.trim() || `Illustratie bij ${title}`;
          return (
            <Link
              className="list-link blog-card"
              key={post.id}
              href={`/blogs/${post.slug}`}
            >
              {image ? (
                <div className="blog-card-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element -- CMS absolute URLs */}
                  <img src={image.url} alt={imageAlt} loading="lazy" />
                </div>
              ) : (
                <div className="blog-card-thumb blog-card-thumb--empty" aria-hidden />
              )}
              <div className="blog-card-body">
                <div className="meta">
                  {date
                    ? new Date(date).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })
                    : null}
                </div>
                <h3>{title}</h3>
                {teaser && <p>{teaser}</p>}
              </div>
            </Link>
          );
        })}
        {ordered.length === 0 && (
          <div className="empty">No blog posts published yet.</div>
        )}
      </div>
    </>
  );
}
