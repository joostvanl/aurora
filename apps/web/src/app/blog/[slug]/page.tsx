import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RichTextBody } from "@/components/RichTextBody";
import { fieldNumber, fieldString, getEntry } from "@/lib/cms";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

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

  const authorSlug = fieldString(post, "authorSlug");
  const author = authorSlug ? await getEntry("author", authorSlug) : null;
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
      {author && (
        <p className="meta">
          By{" "}
          <strong>{fieldString(author, "name")}</strong>
          {fieldString(author, "role") ? ` · ${fieldString(author, "role")}` : ""}
        </p>
      )}
      <RichTextBody value={fieldString(post, "body")} />
      {author && fieldString(author, "bio") && (
        <section className="section" style={{ maxWidth: "42rem" }}>
          <h2 style={{ fontSize: "1.25rem" }}>About the author</h2>
          <p className="meta">{fieldString(author, "bio")}</p>
        </section>
      )}
    </article>
  );
}
