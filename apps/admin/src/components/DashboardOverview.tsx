"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getBrowserAdminClient } from "@/lib/auth";
import {
  buildWebsiteCostBreakdown,
  formatEur,
} from "@/lib/websiteCosts";

type DashboardState = {
  typesCount: number;
  pageEntries: number;
  postEntries: number;
  apiOk: boolean;
  aiEnabled: boolean;
  websiteName: string;
  websiteId: string;
  seatCount: number;
  canManageMembers: boolean;
};

const INITIAL_STATE: DashboardState = {
  typesCount: 0,
  pageEntries: 0,
  postEntries: 0,
  apiOk: false,
  aiEnabled: false,
  websiteName: "This website",
  websiteId: "unknown",
  seatCount: 1,
  canManageMembers: false,
};

export function DashboardOverview() {
  const [state, setState] = useState<DashboardState>(INITIAL_STATE);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const client = getBrowserAdminClient();

      try {
        await client.health();
        const [types, pages, posts, ai, me] = await Promise.all([
          client.listAdminContentTypes(),
          client.listAdminEntries("page", { limit: 1 }).catch(() => ({ total: 0 })),
          client.listAdminEntries("post", { limit: 1 }).catch(() => ({ total: 0 })),
          client.getAiStatus(),
          client.me(),
        ]);

        let seatCount = 1;
        const canManageMembers = me.user.role === "admin";
        if (canManageMembers) {
          try {
            const members = await client.listMembers();
            seatCount = Math.max(1, members.length);
          } catch {
            seatCount = 1;
          }
        }

        if (!cancelled) {
          setState({
            typesCount: types.length,
            pageEntries: pages.total,
            postEntries: posts.total,
            apiOk: true,
            aiEnabled: ai.enabled,
            websiteName: me.user.websiteName ?? "This website",
            websiteId: me.user.websiteId ?? "unknown",
            seatCount,
            canManageMembers,
          });
        }
      } catch {
        if (!cancelled) {
          setState(INITIAL_STATE);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!mounted) {
    return (
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Loading current website…</p>
        </div>
      </div>
    );
  }

  const costs = state.apiOk
    ? buildWebsiteCostBreakdown({
        websiteId: state.websiteId,
        seatCount: state.seatCount,
      })
    : null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>
            {loading
              ? "Loading current website…"
              : state.apiOk
                ? `Managing ${state.websiteName} — schema, content, and usage for this site.`
                : "Schema-driven content for your Aurora website."}
          </p>
        </div>
        <Link className="btn" href="/ai">
          AI settings
        </Link>
      </div>

      <div style={{ display: "grid", gap: "1.25rem" }}>
        <div className="panel" style={{ display: "grid", gap: "1rem" }}>
          <div>
            API status:{" "}
            <span
              className="badge"
              data-status={state.apiOk ? "published" : "draft"}
            >
              {state.apiOk ? "connected" : "unreachable / sign in required"}
            </span>{" "}
            · AI:{" "}
            <span
              className="badge"
              data-status={state.aiEnabled ? "published" : "draft"}
            >
              {state.aiEnabled ? "enabled" : "not configured"}
            </span>
          </div>
          <div className="muted">
            {state.typesCount} content types · {state.pageEntries} pages ·{" "}
            {state.postEntries} posts
            {state.typesCount === 0 && state.apiOk
              ? " — empty workspace; create a type or ask the AI dock on the right."
              : ""}
          </div>
          <div className="actions">
            <Link className="btn btn-secondary" href="/entries/page">
              Edit pages
            </Link>
            <Link className="btn btn-secondary" href="/entries/post">
              Edit posts
            </Link>
            <Link className="btn btn-secondary" href="/content-types">
              Manage types
            </Link>
          </div>
        </div>

        {costs && (
          <div className="panel">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "1rem",
                alignItems: "baseline",
                flexWrap: "wrap",
                marginBottom: "0.75rem",
              }}
            >
              <div>
                <h2
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-display)",
                    fontWeight: 500,
                    fontSize: "1.35rem",
                  }}
                >
                  Website costs
                </h2>
                <p className="muted" style={{ margin: "0.35rem 0 0" }}>
                  Estimated monthly bill for <strong>{state.websiteName}</strong>{" "}
                  — variable pricing (website + seats + page views + AI
                  provider).
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="muted" style={{ fontSize: "0.75rem" }}>
                  Estimated total
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "1.75rem",
                    fontWeight: 500,
                  }}
                >
                  {formatEur(costs.total)}
                </div>
              </div>
            </div>

            <table className="table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Rate</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {costs.lines.map((line) => (
                  <tr key={line.id}>
                    <td>
                      <div>{line.label}</div>
                      <div className="muted" style={{ fontSize: "0.8rem" }}>
                        {line.note}
                      </div>
                    </td>
                    <td className="muted">{line.detail}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {formatEur(line.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: "1rem",
                marginTop: "1rem",
                paddingTop: "0.75rem",
                borderTop: "1px solid var(--line)",
                flexWrap: "wrap",
              }}
            >
              <div
                className="muted"
                style={{ fontSize: "0.85rem", maxWidth: "36rem" }}
              >
                Aurora subtotal {formatEur(costs.auroraSubtotal)}. AI tokens are
                settled on your model provider invoice
                {state.canManageMembers ? (
                  <>
                    {" · "}
                    <Link href="/members">Manage seats</Link>
                  </>
                ) : null}
                .
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="muted" style={{ fontSize: "0.8rem" }}>
                  Aurora only
                </div>
                <strong>{formatEur(costs.auroraSubtotal)}</strong>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
