import type { Metadata } from "next";
import {
  CmsPageBody,
  CmsPageHero,
  cmsPageMetadata,
  getCmsPage,
} from "@/components/CmsPage";
import { RichTextBody } from "@/components/RichTextBody";
import { fieldString, listType } from "@/lib/cms";

export const dynamic = "force-dynamic";

export function generateMetadata(): Promise<Metadata> {
  return cmsPageMetadata("faq", "FAQ");
}

export default async function FaqPage() {
  const [page, faqs] = await Promise.all([
    getCmsPage("faq"),
    listType("faq"),
  ]);

  const categories = Array.from(
    new Set(faqs.map((f) => fieldString(f, "category", "General"))),
  );

  return (
    <>
      <CmsPageHero
        page={page}
        fallbackTitle="FAQ"
        fallbackLead="Answers are FAQ entries — group them with the category field."
      />
      <CmsPageBody page={page} />

      {categories.map((category) => (
        <section className="section" key={category}>
          <h2>{category}</h2>
          <div>
            {faqs
              .filter((f) => fieldString(f, "category", "General") === category)
              .map((f) => (
                <div className="faq-item" key={f.id}>
                  <h3>{fieldString(f, "question", f.slug)}</h3>
                  <RichTextBody
                    className="faq-answer"
                    value={fieldString(f, "answer")}
                  />
                </div>
              ))}
          </div>
        </section>
      ))}

      {faqs.length === 0 && <div className="empty">No FAQs published.</div>}
    </>
  );
}
