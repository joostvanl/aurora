import type { Metadata } from "next";
import Link from "next/link";
import { CmsForm } from "@/components/CmsForm";
import {
  CmsPageHero,
  cmsPageMetadata,
  getCmsPage,
} from "@/components/CmsPage";
import { RichTextBody } from "@/components/RichTextBody";
import { fieldString, listType } from "@/lib/cms";

export const dynamic = "force-dynamic";

export function generateMetadata(): Promise<Metadata> {
  return cmsPageMetadata("about", "About");
}

export default async function AboutPage() {
  const [page, teamPage, team] = await Promise.all([
    getCmsPage("about"),
    getCmsPage("team"),
    listType("team_member"),
  ]);

  const formApiId = page ? fieldString(page, "formApiId") : "";
  const peopleTitle = teamPage
    ? fieldString(teamPage, "title", "Team")
    : "Team";
  const peopleLead = teamPage
    ? fieldString(teamPage, "lead") || "Team members from the CMS."
    : "Team members from the CMS.";

  return (
    <>
      <CmsPageHero page={page} fallbackTitle="About" fallbackLead="About Aurora." />
      {page && (
        <article className="prose" style={{ marginBottom: "2rem" }}>
          <RichTextBody value={fieldString(page, "body")} />
          {formApiId ? (
            <div style={{ marginTop: "2rem" }}>
              <CmsForm apiId={formApiId} />
            </div>
          ) : null}
        </article>
      )}

      <section className="section">
        <div className="section-head">
          <div>
            <h2>{peopleTitle}</h2>
            <p>{peopleLead}</p>
          </div>
          <Link href="/team">Full team →</Link>
        </div>
        <div className="grid-2">
          {team.slice(0, 4).map((m) => (
            <Link className="list-link" key={m.id} href={`/team/${m.slug}`}>
              <h3>{fieldString(m, "name", m.slug)}</h3>
              <p>{fieldString(m, "role")}</p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
