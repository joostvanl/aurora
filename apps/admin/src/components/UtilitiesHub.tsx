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

export function UtilitiesHub() {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setUser(getStoredUser());
  }, []);

  const role = user?.role;
  const isBuilder = role === "builder" || role === "admin";
  const isAdmin = role === "admin";

  const links: HubLink[] = [
    {
      href: "/tokens",
      title: "API tokens",
      description:
        "Management tokens for agents and automation, scoped to this website.",
      visible: isBuilder,
    },
    {
      href: "/packages",
      title: "Packages",
      description:
        "Export and import content packages (types, entries, forms, media) between websites or instances.",
      visible: isAdmin,
    },
  ];

  const visible = links.filter((l) => l.visible);

  if (!user) {
    return <p className="muted">Loading…</p>;
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {visible.length === 0 ? (
        <div className="panel">
          <p className="muted" style={{ margin: 0 }}>
            No utilities available for your role.
          </p>
        </div>
      ) : (
        visible.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="panel"
            style={{
              display: "block",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <strong style={{ display: "block", marginBottom: "0.35rem" }}>
              {item.title}
            </strong>
            <span className="muted">{item.description}</span>
          </Link>
        ))
      )}
    </div>
  );
}
