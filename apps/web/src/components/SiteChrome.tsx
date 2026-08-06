import Link from "next/link";
import {
  fieldString,
  getNavItems,
  getSiteSettings,
  listType,
} from "@/lib/cms";
import { SiteHeaderNav } from "@/components/SiteHeaderNav";

const USE_CASES_HREF = "/work";

export async function SiteHeader() {
  const [settings, nav, projects] = await Promise.all([
    getSiteSettings(),
    getNavItems(),
    listType("project", 1),
  ]);
  const siteName = settings ? fieldString(settings, "siteName", "Aurora") : "Aurora";
  const hasUseCases = projects.length > 0;

  const items = nav
    .map((item) => ({
      id: item.id,
      href: fieldString(item, "href", "/"),
      label: fieldString(item, "label", item.slug),
    }))
    .filter((item) => {
      if (item.href === "/" || item.href === "/contact") return false;
      if (item.href === USE_CASES_HREF && !hasUseCases) return false;
      return true;
    });

  return <SiteHeaderNav siteName={siteName} items={items} />;
}

export async function SiteFooter() {
  const [settings, nav, projects] = await Promise.all([
    getSiteSettings(),
    getNavItems(),
    listType("project", 1),
  ]);
  const siteName = settings ? fieldString(settings, "siteName", "Aurora") : "Aurora";
  const footerText = settings
    ? fieldString(settings, "footerText")
    : "Powered by Aurora CMS.";
  const email = settings ? fieldString(settings, "contactEmail") : "";
  const linkedin = settings ? fieldString(settings, "socialLinkedin") : "";
  const github = settings ? fieldString(settings, "socialGithub") : "";
  const hasUseCases = projects.length > 0;

  const explore = nav.filter((item) => {
    const href = fieldString(item, "href", "/");
    if (href === "/" || href === "/contact") return false;
    if (href === USE_CASES_HREF && !hasUseCases) return false;
    return true;
  });

  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div>
          <div className="footer-brand">{siteName}</div>
          <p>{footerText}</p>
        </div>
        <div>
          <div className="footer-label">Explore</div>
          <div className="footer-links">
            {explore.length > 0 ? (
              explore.map((item) => (
                <Link key={item.id} href={fieldString(item, "href", "/")}>
                  {fieldString(item, "label", item.slug)}
                </Link>
              ))
            ) : (
              <>
                <Link href="/docs">Docs</Link>
                <Link href="/services">Features</Link>
                <Link href="/blog">Guides</Link>
                <Link href="/blogs">Blogs</Link>
                <Link href="/contact">Contact</Link>
              </>
            )}
          </div>
        </div>
        <div>
          <div className="footer-label">Connect</div>
          <div className="footer-links">
            {email && <a href={`mailto:${email}`}>{email}</a>}
            {linkedin && (
              <a href={linkedin} target="_blank" rel="noreferrer">
                LinkedIn
              </a>
            )}
            {github && (
              <a href={github} target="_blank" rel="noreferrer">
                GitHub
              </a>
            )}
            <Link href="/contact">Contact</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
