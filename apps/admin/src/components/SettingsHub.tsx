"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AuthUser } from "@cms/shared";
import { getStoredUser } from "@/lib/auth";

type HubLink = {
  href: string;
  title: string;
  description: string;
  visible: boolean;
};

export function SettingsHub() {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setUser(getStoredUser());
  }, []);

  const role = user?.role;
  const isAdmin = role === "admin";
  const showAi = Boolean(user?.websiteId);

  const links: HubLink[] = [
    {
      href: "/website",
      title: "Website",
      description:
        "Studio identity for this tenant (name and site key). Public brand lives in site_settings content.",
      visible: isAdmin,
    },
    {
      href: "/members",
      title: "Members",
      description: "Invite people and manage roles for this website.",
      visible: isAdmin,
    },
    {
      href: "/ai",
      title: "AI settings",
      description:
        "Provider config, cost per token, and recorded AI usage for this website.",
      visible: showAi,
    },
    {
      href: "/select-website",
      title: "Websites",
      description: "Switch between websites you belong to, or create a new one.",
      visible: true,
    },
  ];

  const visible = links.filter((l) => l.visible);

  if (!user) {
    return <p className="muted">Loading…</p>;
  }

  return (
    <div className="hub-grid">
      {visible.map((item) => (
        <Link key={item.href} href={item.href} className="hub-card">
          <strong>{item.title}</strong>
          <p>{item.description}</p>
        </Link>
      ))}
    </div>
  );
}
