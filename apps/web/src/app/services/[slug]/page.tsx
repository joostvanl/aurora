import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RichTextBody } from "@/components/RichTextBody";
import { fieldString, getEntry, listType } from "@/lib/cms";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const service = await getEntry("service", slug);
  return {
    title: service ? fieldString(service, "title", slug) : slug,
    description: service ? fieldString(service, "summary") || undefined : undefined,
  };
}

export default async function ServiceDetailPage({ params }: Props) {
  const { slug } = await params;
  const [service, others] = await Promise.all([
    getEntry("service", slug),
    listType("service"),
  ]);
  if (!service) notFound();

  return (
    <>
      <p className="meta">
        <Link href="/services">← Services</Link>
      </p>
      <article className="prose">
        <p className="eyebrow">{fieldString(service, "icon")}</p>
        <h1>{fieldString(service, "title", slug)}</h1>
        <p className="lead">{fieldString(service, "summary")}</p>
        <RichTextBody value={fieldString(service, "body")} />
      </article>

      <section className="section">
        <h2>More services</h2>
        <div>
          {others
            .filter((s) => s.slug !== slug)
            .map((s) => (
              <Link className="list-link" key={s.id} href={`/services/${s.slug}`}>
                <h3>{fieldString(s, "title", s.slug)}</h3>
                <p>{fieldString(s, "summary")}</p>
              </Link>
            ))}
        </div>
      </section>
    </>
  );
}
