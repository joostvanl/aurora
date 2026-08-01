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
  return cmsPageMetadata("work", "Use cases");
}

export default async function WorkPage() {
  const [page, projects] = await Promise.all([
    getCmsPage("work"),
    listType("project"),
  ]);

  return (
    <>
      <CmsPageHero
        page={page}
        fallbackTitle="Use cases"
        fallbackLead="Scenarios are project entries in Aurora."
      />
      <CmsPageBody page={page} />
      <div>
        {projects.map((p) => (
          <Link className="list-link" key={p.id} href={`/work/${p.slug}`}>
            <div className="meta">
              {fieldString(p, "client")}
              {fieldString(p, "year") ? ` · ${fieldString(p, "year")}` : ""}
              {fieldString(p, "tags") ? ` · ${fieldString(p, "tags")}` : ""}
            </div>
            <h3>{fieldString(p, "title", p.slug)}</h3>
            <p>{fieldString(p, "summary")}</p>
          </Link>
        ))}
        {projects.length === 0 && (
          <div className="empty">No use cases published.</div>
        )}
      </div>
    </>
  );
}
