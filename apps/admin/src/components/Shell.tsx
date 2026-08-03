"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AuthUser, ContentType, WebsiteMembership } from "@cms/shared";
import {
  clearSession,
  getBrowserAdminClient,
  getStoredToken,
  getStoredUser,
  syncSessionCookie,
  storeSession,
} from "@/lib/auth";
import { logout } from "@/components/LoginForm";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createCmsClient } from "@cms/shared";
import {
  AiScreenProvider,
  onAiStudioMutated,
  useAiScreen,
} from "@/components/AiScreenContext";
import { AiAssistantDock } from "@/components/AiAssistantDock";

export function Shell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isAuthPage =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/select-website";
  const [ready, setReady] = useState(isAuthPage);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [types, setTypes] = useState<ContentType[]>([]);
  const [websites, setWebsites] = useState<WebsiteMembership[]>([]);
  const [switchingWebsite, setSwitchingWebsite] = useState(false);

  useEffect(() => {
    if (isAuthPage) {
      setReady(true);
      return;
    }

    const token = getStoredToken();
    if (!token) {
      router.replace("/login");
      return;
    }

    setUser(getStoredUser());
    const client = getBrowserAdminClient();
    client
      .me()
      .then(async (res) => {
        setUser(res.user);
        setWebsites(res.websites);
        if (res.needsWebsiteSelection || !res.user.websiteId) {
          router.replace("/select-website");
          return;
        }
        storeSession(token, res.user);
        const items = await client.listAdminContentTypes();
        setTypes(items);
        setReady(true);
      })
      .catch(() => {
        logout();
        router.replace("/login");
      });
  }, [isAuthPage, pathname, router]);

  async function switchWebsite(websiteId: string) {
    const token = getStoredToken();
    if (!token) return;
    if (websiteId === user?.websiteId) return;

    setSwitchingWebsite(true);
    setReady(false);
    setTypes([]);

    const client = createCmsClient({
      baseUrl: process.env.NEXT_PUBLIC_CMS_API_URL ?? "http://localhost:4000",
      token,
    });
    try {
      const res = await client.selectWebsite({ websiteId });
      storeSession(res.token, res.user);
      setUser(res.user);
      await syncSessionCookie(res.token);
      window.location.assign("/");
    } catch (error) {
      setReady(true);
      setSwitchingWebsite(false);
      throw error;
    }
  }

  if (isAuthPage) {
    return <>{children}</>;
  }

  if (!ready) {
    return (
      <div className="auth-shell muted">
        {switchingWebsite ? "Switching website…" : "Loading studio…"}
      </div>
    );
  }

  return (
    <AiScreenProvider websiteName={user?.websiteName}>
      <ShellFrame
        user={user}
        websites={websites}
        types={types}
        switchingWebsite={switchingWebsite}
        onSwitchWebsite={(id) => void switchWebsite(id)}
        onSignOut={() => {
          clearSession();
          document.cookie = "aurora_cms_token=; path=/; max-age=0";
          router.replace("/login");
        }}
      >
        {children}
      </ShellFrame>
    </AiScreenProvider>
  );
}

function navActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function ShellFrame({
  children,
  user,
  websites,
  types,
  switchingWebsite,
  onSwitchWebsite,
  onSignOut,
}: {
  children: React.ReactNode;
  user: AuthUser | null;
  websites: WebsiteMembership[];
  types: ContentType[];
  switchingWebsite: boolean;
  onSwitchWebsite: (websiteId: string) => void;
  onSignOut: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const { collapsed, setCollapsed, dockWidth } = useAiScreen();
  const isAdmin = user?.role === "admin";
  const showAi = Boolean(user?.websiteId);
  const [contentKey, setContentKey] = useState(0);
  const [navTypes, setNavTypes] = useState(types);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavTypes(types);
  }, [types]);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.classList.toggle("nav-open", navOpen);
    document.body.classList.toggle("ai-open", !collapsed);
    return () => {
      document.body.classList.remove("nav-open", "ai-open");
    };
  }, [navOpen, collapsed]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setNavOpen(false);
      if (!collapsed) setCollapsed(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed, setCollapsed]);

  useEffect(() => {
    return onAiStudioMutated(() => {
      router.refresh();
      getBrowserAdminClient()
        .listAdminContentTypes()
        .then(setNavTypes)
        .catch(() => {
          /* keep current nav */
        });
      window.setTimeout(() => {
        setContentKey((k) => k + 1);
        router.refresh();
      }, 150);
    });
  }, [router]);

  return (
    <div
      className="shell"
      style={{ ["--ai-dock" as string]: `${dockWidth}px` }}
    >
      <header className="topbar">
        <button
          className="topbar-btn topbar-btn--menu"
          type="button"
          aria-expanded={navOpen}
          aria-controls="studio-nav"
          onClick={() => setNavOpen((v) => !v)}
        >
          Menu
        </button>
        <Link className="topbar-brand" href="/">
          <img src="/aurora-mark.png" alt="" width={28} height={28} />
          <span>Aurora</span>
        </Link>
        {user?.websiteName && (
          <div className="topbar-meta" title={user.websiteName}>
            {user.websiteName} · {user.role}
          </div>
        )}
        <div className="topbar-spacer" />
        {showAi && (
          <button
            className="topbar-btn"
            type="button"
            data-active={!collapsed ? "true" : undefined}
            aria-pressed={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            AI
          </button>
        )}
      </header>

      <div className="shell-body">
        <button
          type="button"
          className={`sidebar-backdrop${navOpen ? " is-open" : ""}`}
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
        />

        <aside
          id="studio-nav"
          className={`sidebar${navOpen ? " is-open" : ""}`}
        >
          <div className="sidebar-site">
            <strong>{user?.websiteName ?? "Website"}</strong>
            <span className="muted">{user?.role}</span>
          </div>

          <nav className="nav">
            <Link href="/" data-active={navActive(pathname, "/")}>
              Dashboard
            </Link>
            {(user?.role === "builder" || user?.role === "admin") && (
              <Link
                href="/content-types"
                data-active={navActive(pathname, "/content-types")}
              >
                Content types
              </Link>
            )}
            <Link href="/forms" data-active={navActive(pathname, "/forms")}>
              Forms
            </Link>
            {(user?.role === "builder" || user?.role === "admin") && (
              <Link
                href="/utilities"
                data-active={navActive(pathname, "/utilities")}
              >
                Utilities
              </Link>
            )}
            <Link
              href="/settings"
              data-active={navActive(pathname, "/settings")}
            >
              Settings
            </Link>
            <div className="nav-section">Entries</div>
            {navTypes.map((t) => (
              <Link
                key={t.apiId}
                href={`/entries/${t.apiId}`}
                data-active={navActive(pathname, `/entries/${t.apiId}`)}
              >
                {t.name}
              </Link>
            ))}
            {navTypes.length === 0 && (
              <span className="nav-section" style={{ textTransform: "none" }}>
                No types yet
              </span>
            )}
          </nav>

          <div className="sidebar-footer">
            {websites.length > 1 && (
              <>
                <div className="nav-section">Switch website</div>
                <select
                  value={user?.websiteId ?? ""}
                  disabled={switchingWebsite}
                  onChange={(e) => onSwitchWebsite(e.target.value)}
                >
                  {websites.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            <div className="sidebar-account">
              <div>{user?.email}</div>
              {user?.siteKey && (
                <div title="Public site key">siteKey: {user.siteKey}</div>
              )}
              {!isAdmin && showAi && (
                <div>AI provider settings: admin only</div>
              )}
            </div>
            <button className="btn btn-secondary" type="button" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        </aside>

        <main className="main" key={contentKey}>
          {children}
        </main>
      </div>

      {showAi && (
        <>
          <button
            type="button"
            className={`ai-backdrop${!collapsed ? " is-open" : ""}`}
            aria-label="Close AI assistant"
            onClick={() => setCollapsed(true)}
          />
          <AiAssistantDock user={user} />
        </>
      )}
    </div>
  );
}
