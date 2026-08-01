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
  const { dockWidth } = useAiScreen();
  const isAdmin = user?.role === "admin";
  const showAi = Boolean(user?.websiteId);
  const [contentKey, setContentKey] = useState(0);
  const [navTypes, setNavTypes] = useState(types);

  useEffect(() => {
    setNavTypes(types);
  }, [types]);

  useEffect(() => {
    return onAiStudioMutated(() => {
      router.refresh();
      getBrowserAdminClient()
        .listAdminContentTypes()
        .then(setNavTypes)
        .catch(() => {
          /* keep current nav */
        });
      // Remount page UI after refresh has a chance to deliver new RSC props.
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
      <aside className="sidebar">
        <div className="brand">
          Aurora
          <span>Content studio</span>
        </div>
        {user?.websiteName && (
          <div
            style={{
              padding: "0 0.7rem 0.75rem",
              fontSize: "0.85rem",
              opacity: 0.9,
            }}
          >
            <strong>{user.websiteName}</strong>
            <div className="muted" style={{ fontSize: "0.75rem" }}>
              {user.role}
            </div>
          </div>
        )}
        <nav className="nav">
          <Link href="/">Dashboard</Link>
          {(user?.role === "builder" || user?.role === "admin") && (
            <Link href="/content-types">Content types</Link>
          )}
          <Link href="/forms">Forms</Link>
          {(user?.role === "builder" || user?.role === "admin") && (
            <Link href="/tokens">API tokens</Link>
          )}
          {showAi && <Link href="/ai">AI settings</Link>}
          {isAdmin && <Link href="/website">Website</Link>}
          {isAdmin && <Link href="/members">Members</Link>}
          <Link href="/select-website">Websites</Link>
          <div className="nav-section">Entries</div>
          {navTypes.map((t) => (
            <Link key={t.apiId} href={`/entries/${t.apiId}`}>
              {t.name}
            </Link>
          ))}
          {navTypes.length === 0 && (
            <span
              className="nav-section"
              style={{ opacity: 0.7, textTransform: "none" }}
            >
              No types yet
            </span>
          )}
        </nav>
        <div style={{ marginTop: "auto", paddingTop: "1.5rem" }}>
          {websites.length > 1 && (
            <>
              <div className="nav-section">Switch website</div>
              <select
                value={user?.websiteId ?? ""}
                disabled={switchingWebsite}
                onChange={(e) => onSwitchWebsite(e.target.value)}
                style={{
                  margin: "0 0.7rem 0.75rem",
                  width: "calc(100% - 1.4rem)",
                }}
              >
                {websites.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <div className="nav-section">Account</div>
          <div
            style={{ padding: "0 0.7rem", fontSize: "0.85rem", opacity: 0.85 }}
          >
            {user?.email}
          </div>
          {user?.siteKey && (
            <div
              style={{
                padding: "0.35rem 0.7rem 0",
                fontSize: "0.7rem",
                opacity: 0.65,
                wordBreak: "break-all",
              }}
              title="Public site key for this website"
            >
              siteKey: {user.siteKey}
            </div>
          )}
          {!isAdmin && showAi && (
            <div
              className="muted"
              style={{ padding: "0.5rem 0.7rem 0", fontSize: "0.7rem" }}
            >
              AI provider settings: admin only
            </div>
          )}
          <button
            className="btn btn-secondary"
            type="button"
            style={{
              margin: "0.75rem 0.7rem 0",
              width: "calc(100% - 1.4rem)",
            }}
            onClick={onSignOut}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="main" key={contentKey}>
        {children}
      </main>
      <AiAssistantDock user={user} />
    </div>
  );
}
