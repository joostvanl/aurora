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
  return cmsPageMetadata("services", "Features");
}

export default async function ServicesPage() {
  const [page, services] = await Promise.all([
    getCmsPage("services"),
    listType("service"),
  ]);

  return (
    <>
      <CmsPageHero
        page={page}
        fallbackTitle="Features"
        fallbackLead="Each capability is a published service entry."
      />
      <CmsPageBody page={page} />
      <div>
        {services.map((s) => (
          <Link className="list-link" key={s.id} href={`/services/${s.slug}`}>
            <span className="icon-mark">{fieldString(s, "icon", "•")}</span>
            <h3>{fieldString(s, "title", s.slug)}</h3>
            <p>{fieldString(s, "summary")}</p>
          </Link>
        ))}
        {services.length === 0 && (
          <div className="empty">No features published.</div>
        )}
      </div>
    </>
  );
}
