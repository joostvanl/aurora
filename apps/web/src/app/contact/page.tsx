import type { Metadata } from "next";
import Link from "next/link";
import { CmsForm } from "@/components/CmsForm";
import {
  CmsPageHero,
  cmsPageMetadata,
  getCmsPage,
} from "@/components/CmsPage";
import { RichTextBody } from "@/components/RichTextBody";
import { fieldString, getSiteSettings } from "@/lib/cms";

export const dynamic = "force-dynamic";

export function generateMetadata(): Promise<Metadata> {
  return cmsPageMetadata("contact", "Contact");
}

export default async function ContactPage() {
  const [page, settings] = await Promise.all([
    getCmsPage("contact"),
    getSiteSettings(),
  ]);

  const email = settings ? fieldString(settings, "contactEmail") : "";
  const phone = settings ? fieldString(settings, "contactPhone") : "";
  const address = settings ? fieldString(settings, "address") : "";
  const formApiId = page
    ? fieldString(page, "formApiId", "contact")
    : "contact";

  return (
    <>
      <CmsPageHero
        page={page}
        fallbackTitle="Contact"
        fallbackLead="Reach the Aurora team through details stored in site settings."
      />

      <div className="grid-2">
        <article className="prose">
          {page ? (
            <RichTextBody value={fieldString(page, "body")} />
          ) : (
            <div className="body">Contact details load from the CMS.</div>
          )}
          {formApiId ? (
            <div style={{ marginTop: "1.75rem" }}>
              <h2 style={{ fontSize: "1.25rem", marginBottom: "0.75rem" }}>
                Message us
              </h2>
              <CmsForm apiId={formApiId} />
            </div>
          ) : null}
        </article>
        <aside>
          <div className="footer-label">Direct</div>
          <div className="footer-links" style={{ marginTop: "0.75rem" }}>
            {email && <a href={`mailto:${email}`}>{email}</a>}
            {phone && <span className="meta">{phone}</span>}
            {address && (
              <p className="meta" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                {address}
              </p>
            )}
            <Link href="/faq">Browse FAQ</Link>
          </div>
        </aside>
      </div>
    </>
  );
}
