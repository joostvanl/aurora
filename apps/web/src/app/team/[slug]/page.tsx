import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fieldString, getEntry } from "@/lib/cms";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const member = await getEntry("team_member", slug);
  return {
    title: member ? fieldString(member, "name", slug) : slug,
  };
}

export default async function TeamMemberPage({ params }: Props) {
  const { slug } = await params;
  const member = await getEntry("team_member", slug);
  if (!member) notFound();

  const email = fieldString(member, "email");

  return (
    <>
      <p className="meta">
        <Link href="/team">← Team</Link>
      </p>
      <article className="prose">
        <p className="eyebrow">{fieldString(member, "role")}</p>
        <h1>{fieldString(member, "name", slug)}</h1>
        <p className="lead">{fieldString(member, "bio")}</p>
        {email && <p><a href={`mailto:${email}`}>{email}</a></p>}
      </article>
    </>
  );
}
