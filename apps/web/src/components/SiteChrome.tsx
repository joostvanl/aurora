import Link from "next/link";
import {
  fieldString,
  getNavItems,
  getSiteSettings,
} from "@/lib/cms";

export async function SiteHeader() {
  const [settings, nav] = await Promise.all([getSiteSettings(), getNavItems()]);
  const siteName = settings ? fieldString(settings, "siteName", "Aurora") : "Aurora";

  return (
    <header className="topbar">
      <Link className="logo" href="/">
        {siteName}
      </Link>
      <nav className="nav">
        {nav.length > 0 ? (
          nav.map((item) => (
            <Link key={item.id} href={fieldString(item, "href", "/")}>
              {fieldString(item, "label", item.slug)}
            </Link>
          ))
        ) : (
          <>
            <Link href="/">Product</Link>
            <Link href="/docs">Docs</Link>
            <Link href="/contact">Contact</Link>
          </>
        )}
      </nav>
    </header>
  );
}

export async function SiteFooter() {
  const [settings, nav] = await Promise.all([getSiteSettings(), getNavItems()]);
  const siteName = settings ? fieldString(settings, "siteName", "Aurora") : "Aurora";
  const footerText = settings
    ? fieldString(settings, "footerText")
    : "Powered by Aurora CMS.";
  const email = settings ? fieldString(settings, "contactEmail") : "";
  const linkedin = settings ? fieldString(settings, "socialLinkedin") : "";
  const github = settings ? fieldString(settings, "socialGithub") : "";

  const explore = nav.filter((item) => {
    const href = fieldString(item, "href", "/");
    return href !== "/";
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
