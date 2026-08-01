import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RichTextBody } from "@/components/RichTextBody";
import { fieldMedia, fieldString, getEntry } from "@/lib/cms";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getEntry("blog", slug);
  return {
    title: post ? fieldString(post, "title", slug) : slug,
  };
}

export default async function BlogArticlePage({ params }: Props) {
  const { slug } = await params;
  const post = await getEntry("blog", slug);
  if (!post) notFound();

  const date = post.publishedAt ?? post.createdAt;
  const image = fieldMedia(post, "image");
  const title = fieldString(post, "title", slug);
  const imageAlt = image?.alt?.trim() || title;

  return (
    <article className="prose">
      <p className="meta">
        <Link href="/blogs">← Blogs</Link>
        {date
          ? ` · ${new Date(date).toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}`
          : null}
      </p>
      {image && (
        <div className="blog-hero-image">
          {/* eslint-disable-next-line @next/next/no-img-element -- CMS absolute URLs */}
          <img src={image.url} alt={imageAlt} loading="eager" />
        </div>
      )}
      <h1>{title}</h1>
      <RichTextBody value={fieldString(post, "body")} />
    </article>
  );
}
