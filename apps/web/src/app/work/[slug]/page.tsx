import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RichTextBody } from "@/components/RichTextBody";
import { fieldString, getEntry } from "@/lib/cms";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const project = await getEntry("project", slug);
  return {
    title: project ? fieldString(project, "title", slug) : slug,
    description: project ? fieldString(project, "summary") || undefined : undefined,
  };
}

export default async function ProjectDetailPage({ params }: Props) {
  const { slug } = await params;
  const project = await getEntry("project", slug);
  if (!project) notFound();

  return (
    <>
      <p className="meta">
        <Link href="/work">← Work</Link>
        {" · "}
        {fieldString(project, "client")}
        {fieldString(project, "year") ? ` · ${fieldString(project, "year")}` : ""}
      </p>
      <article className="prose">
        <h1>{fieldString(project, "title", slug)}</h1>
        <p className="lead">{fieldString(project, "summary")}</p>
        {fieldString(project, "tags") && (
          <p className="tag">{fieldString(project, "tags")}</p>
        )}
        <div style={{ marginTop: "1.25rem" }}>
          <RichTextBody value={fieldString(project, "body")} />
        </div>
      </article>
    </>
  );
}
