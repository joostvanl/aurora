import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RichTextBody } from "@/components/RichTextBody";
import { fieldNumber, fieldString, getEntry } from "@/lib/cms";
import type { FlatEntry } from "@cms/shared";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

function authorSlugsFromPost(post: FlatEntry): string[] {
  // Live schema: relation field `author` (single slug). Also accept `authors` multi.
  const multi = post.fields.authors;
  if (Array.isArray(multi)) {
    return multi.filter(
      (v): v is string => typeof v === "string" && v.trim().length > 0,
    );
  }
  const single = fieldString(post, "author").trim();
  if (single) return [single];
  const legacy = fieldString(post, "authorSlug").trim();
  return legacy ? [legacy] : [];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getEntry("post", slug);
  return {
    title: post ? fieldString(post, "title", slug) : slug,
    description: post ? fieldString(post, "excerpt") || undefined : undefined,
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = await getEntry("post", slug);
  if (!post) notFound();

  const authorSlugs = authorSlugsFromPost(post);
  const authors = (
    await Promise.all(authorSlugs.map((s) => getEntry("author", s)))
  ).filter((a): a is FlatEntry => Boolean(a));

  const date =
    typeof post.fields.publishedDate === "string"
      ? post.fields.publishedDate
      : post.publishedAt;
  const minutes = fieldNumber(post, "readingMinutes");

  return (
    <article className="prose">
      <p className="meta">
        <Link href="/blog">← Journal</Link>
        {" · "}
        <span className="tag">{fieldString(post, "category", "Note")}</span>
        {date
          ? ` · ${new Date(date).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}`
          : null}
        {minutes ? ` · ${minutes} min read` : null}
      </p>
      <h1>{fieldString(post, "title", slug)}</h1>
      {fieldString(post, "excerpt") && (
        <p className="lead">{fieldString(post, "excerpt")}</p>
      )}
      {authors.length > 0 && (
        <p className="meta">
          By{" "}
          {authors.map((author, i) => (
            <span key={author.id}>
              {i > 0 ? (i === authors.length - 1 ? " and " : ", ") : null}
              <strong>{fieldString(author, "name")}</strong>
              {fieldString(author, "role")
                ? ` · ${fieldString(author, "role")}`
                : ""}
            </span>
          ))}
        </p>
      )}
      <RichTextBody value={fieldString(post, "body")} />
      {authors.length > 0 && (
        <section className="section" style={{ maxWidth: "42rem" }}>
          <h2 style={{ fontSize: "1.25rem" }}>
            {authors.length === 1 ? "About the author" : "About the authors"}
          </h2>
          {authors.map((author) =>
            fieldString(author, "bio") ? (
              <p key={author.id} className="meta">
                <strong>{fieldString(author, "name")}</strong>
                {" — "}
                {fieldString(author, "bio")}
              </p>
            ) : null,
          )}
        </section>
      )}
    </article>
  );
}
