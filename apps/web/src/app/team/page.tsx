import type { Metadata } from "next";
import Link from "next/link";
import {
  CmsPageBody,
  CmsPageHero,
  cmsPageMetadata,
  getCmsPage,
} from "@/components/CmsPage";
import { fieldString, listType } from "@/lib/cms";

export const dynamic = "force-dynamic";

export function generateMetadata(): Promise<Metadata> {
  return cmsPageMetadata("team", "Team");
}

export default async function TeamPage() {
  const [page, team] = await Promise.all([
    getCmsPage("team"),
    listType("team_member"),
  ]);

  return (
    <>
      <CmsPageHero
        page={page}
        fallbackTitle="Team"
        fallbackLead="Bios and roles live as team_member entries."
      />
      <CmsPageBody page={page} />
      <div className="grid-2">
        {team.map((m) => (
          <Link className="list-link" key={m.id} href={`/team/${m.slug}`}>
            <h3>{fieldString(m, "name", m.slug)}</h3>
            <p>{fieldString(m, "role")}</p>
            <p>{fieldString(m, "bio")}</p>
          </Link>
        ))}
        {team.length === 0 && (
          <div className="empty">No team members published.</div>
        )}
      </div>
    </>
  );
}
