import Link from "next/link";
import { RichTextBody } from "@/components/RichTextBody";
import {
  fieldString,
  getEntry,
  getSiteSettings,
  listType,
  plainTextExcerpt,
} from "@/lib/cms";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [
    home,
    settings,
    servicesPage,
    workPage,
    blogPage,
    testimonialsPage,
    services,
    projects,
    testimonials,
    posts,
  ] = await Promise.all([
    getEntry("page", "home"),
    getSiteSettings(),
    getEntry("page", "services"),
    getEntry("page", "work"),
    getEntry("page", "blog"),
    getEntry("page", "testimonials"),
    listType("service"),
    listType("project"),
    listType("testimonial"),
    listType("post", 3),
  ]);

  const title = home
    ? fieldString(home, "title", "Aurora")
    : "Ship frontends. Edit content without deploys.";
  const eyebrow = home
    ? fieldString(home, "eyebrow", "Aurora headless CMS")
    : "Aurora headless CMS";
  const lead = home
    ? fieldString(home, "lead") || plainTextExcerpt(fieldString(home, "body"))
    : "Content will appear once the API is seeded.";
  const ctaLabel = settings
    ? fieldString(settings, "ctaLabel", "Read the docs")
    : "Read the docs";
  const ctaHref = settings ? fieldString(settings, "ctaHref", "/docs") : "/docs";
  const secondaryCtaLabel = home
    ? fieldString(home, "secondaryCtaLabel", "Explore features")
    : "Explore features";
  const secondaryCtaHref = home
    ? fieldString(home, "secondaryCtaHref", "/services")
    : "/services";
  const ctaTitle = home
    ? fieldString(home, "ctaTitle", "Build on Aurora")
    : "Build on Aurora";
  const ctaLead = home
    ? fieldString(home, "ctaLead") ||
      "Read the docs, grab the demo site key, and point your frontend at the public API."
    : "Read the docs, grab the demo site key, and point your frontend at the public API.";

  const featuresTitle = servicesPage
    ? fieldString(servicesPage, "title", "Features")
    : "Features";
  const featuresLead = servicesPage
    ? fieldString(servicesPage, "lead") ||
      "What Aurora ships for editors and developers."
    : "What Aurora ships for editors and developers.";
  const useCasesTitle = workPage
    ? fieldString(workPage, "title", "Use cases")
    : "Use cases";
  const useCasesLead = workPage
    ? fieldString(workPage, "lead") || "How teams put Aurora to work."
    : "How teams put Aurora to work.";
  const guidesTitle = blogPage
    ? fieldString(blogPage, "title", "Guides")
    : "Guides";
  const guidesLead = blogPage
    ? fieldString(blogPage, "lead") || "Published posts from the public API."
    : "Published posts from the public API.";
  const socialTitle = testimonialsPage
    ? fieldString(testimonialsPage, "title", "From teams using Aurora")
    : "From teams using Aurora";
  const socialLead = testimonialsPage
    ? fieldString(testimonialsPage, "lead") ||
      "Social proof managed as its own content type."
    : "Social proof managed as its own content type.";

  const siteName = settings
    ? fieldString(settings, "siteName", "Aurora")
    : "Aurora";

  return (
    <>
      <section className="hero">
        <div className="hero-atmosphere" aria-hidden="true">
          <div className="hero-grid" />
          <div className="hero-orb hero-orb--a" />
          <div className="hero-orb hero-orb--b" />
        </div>
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="hero-brand">{siteName}</p>
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <p className="hero-lead">{lead}</p>
            <div className="cta-row">
              <Link className="btn" href={ctaHref}>
                {ctaLabel}
              </Link>
              <Link className="btn btn-ghost" href={secondaryCtaHref}>
                {secondaryCtaLabel}
              </Link>
            </div>
          </div>
        </div>
      </section>

      {home && fieldString(home, "body") ? (
        <section className="section">
          <article className="prose">
            <RichTextBody value={fieldString(home, "body")} />
          </article>
        </section>
      ) : null}

      <section className="section">
        <div className="section-head">
          <div>
            <h2>{featuresTitle}</h2>
            <p>{featuresLead}</p>
          </div>
          <Link href="/services">All features →</Link>
        </div>
        <div className="grid-2">
          {services.slice(0, 4).map((s) => (
            <Link
              className="list-link"
              key={s.id}
              href={`/services/${s.slug}`}
              style={{ borderTop: "1px solid var(--line)" }}
            >
              <span className="icon-mark">{fieldString(s, "icon", "•")}</span>
              <h3>{fieldString(s, "title", s.slug)}</h3>
              <p>{fieldString(s, "summary")}</p>
            </Link>
          ))}
          {services.length === 0 && (
            <div className="empty">No features published yet.</div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>{useCasesTitle}</h2>
            <p>{useCasesLead}</p>
          </div>
          <Link href="/work">View use cases →</Link>
        </div>
        <div>
          {projects.slice(0, 3).map((p) => (
            <Link className="list-link" key={p.id} href={`/work/${p.slug}`}>
              <div className="meta">
                {fieldString(p, "client")}
                {fieldString(p, "year") ? ` · ${fieldString(p, "year")}` : ""}
              </div>
              <h3>{fieldString(p, "title", p.slug)}</h3>
              <p>{fieldString(p, "summary")}</p>
            </Link>
          ))}
          {projects.length === 0 && (
            <div className="empty">No use cases published yet.</div>
          )}
        </div>
      </section>

      <section className="section band">
        <h2>{socialTitle}</h2>
        <p>{socialLead}</p>
        <div className="grid-3" style={{ marginTop: "1.25rem" }}>
          {testimonials.map((t) => (
            <figure className="quote" key={t.id}>
              <blockquote>“{fieldString(t, "quote")}”</blockquote>
              <cite>
                {fieldString(t, "authorName")}
                {fieldString(t, "authorRole")
                  ? `, ${fieldString(t, "authorRole")}`
                  : ""}
                {fieldString(t, "company")
                  ? ` — ${fieldString(t, "company")}`
                  : ""}
              </cite>
            </figure>
          ))}
          {testimonials.length === 0 && (
            <div className="empty">No testimonials yet.</div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h2>{guidesTitle}</h2>
            <p>{guidesLead}</p>
          </div>
          <Link href="/blog">All guides →</Link>
        </div>
        <div>
          {posts.map((post) => (
            <Link
              className="list-link"
              key={post.id}
              href={`/blog/${post.slug}`}
            >
              <div className="meta">
                <span className="tag">
                  {fieldString(post, "category", "Guide")}
                </span>
                {typeof post.fields.publishedDate === "string"
                  ? ` · ${new Date(post.fields.publishedDate).toLocaleDateString()}`
                  : ""}
              </div>
              <h3>{fieldString(post, "title", post.slug)}</h3>
              <p>{fieldString(post, "excerpt")}</p>
            </Link>
          ))}
          {posts.length === 0 && (
            <div className="empty">No guides published yet.</div>
          )}
        </div>
      </section>

      <section className="cta-band">
        <h2>{ctaTitle}</h2>
        <p>{ctaLead}</p>
        <div className="cta-row">
          <Link className="btn" href={ctaHref}>
            {ctaLabel}
          </Link>
          <Link className="btn btn-ghost" href="/faq">
            FAQ
          </Link>
        </div>
      </section>
    </>
  );
}
