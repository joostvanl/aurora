"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export type SiteNavItem = {
  id: string;
  href: string;
  label: string;
};

export function SiteHeaderNav({
  siteName,
  items,
}: {
  siteName: string;
  items: SiteNavItem[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.classList.toggle("site-nav-open", open);
    return () => document.body.classList.remove("site-nav-open");
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const links =
    items.length > 0
      ? items
      : [
          { id: "home", href: "/", label: "Product" },
          { id: "docs", href: "/docs", label: "Docs" },
          { id: "services", href: "/services", label: "Features" },
          { id: "blog", href: "/blog", label: "Guides" },
          { id: "blogs", href: "/blogs", label: "Blogs" },
          { id: "contact", href: "/contact", label: "Contact" },
        ];

  return (
    <>
      <header className="topbar">
        <Link className="logo" href="/">
          <img src="/aurora-mark.png" alt="" width={28} height={28} />
          <span>{siteName}</span>
        </Link>
        <nav className="nav" aria-label="Primary">
          {links.map((item) => (
            <Link key={item.id} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="topbar-actions">
          <Link className="btn btn-ghost" href="/contact" style={{ padding: "0.4rem 0.8rem" }}>
            Contact
          </Link>
          <button
            className="nav-toggle"
            type="button"
            aria-expanded={open}
            aria-controls="site-nav-drawer"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </header>

      <button
        type="button"
        className={`nav-backdrop${open ? " is-open" : ""}`}
        aria-label="Close menu"
        onClick={() => setOpen(false)}
      />
      <div
        id="site-nav-drawer"
        className={`nav-drawer${open ? " is-open" : ""}`}
      >
        <nav aria-label="Mobile">
          {links.map((item) => (
            <Link key={item.id} href={item.href} onClick={() => setOpen(false)}>
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </>
  );
}
