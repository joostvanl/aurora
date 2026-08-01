import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CmsForm } from "@/components/CmsForm";
import {
  CmsPageHero,
  cmsPageMetadata,
  getCmsPage,
} from "@/components/CmsPage";
import { RichTextBody } from "@/components/RichTextBody";
import { fieldString } from "@/lib/cms";

export const dynamic = "force-dynamic";

export function generateMetadata(): Promise<Metadata> {
  return cmsPageMetadata("pricing", "Pricing");
}

export default async function PricingPage() {
  const page = await getCmsPage("pricing");
  if (!page) notFound();

  const formApiId = fieldString(page, "formApiId");

  return (
    <>
      <CmsPageHero page={page} fallbackTitle="Pricing" />
      <article className="prose">
        <RichTextBody value={fieldString(page, "body")} />
        {formApiId ? (
          <div style={{ marginTop: "2rem" }}>
            <CmsForm apiId={formApiId} />
          </div>
        ) : null}
      </article>
    </>
  );
}
