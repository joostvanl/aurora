"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Form } from "@cms/shared";
import { CreateFormForm } from "@/components/CreateFormForm";
import { getBrowserAdminClient, getStoredUser } from "@/lib/auth";

export function FormsOverview() {
  const [forms, setForms] = useState<Form[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const role = getStoredUser()?.role;
    setCanManage(role === "builder" || role === "admin");
    getBrowserAdminClient()
      .listForms()
      .then(setForms)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load forms"),
      );
  }, []);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Forms</h1>
          <p>
            {canManage
              ? "Build public forms, embed them on your site, and review submissions here."
              : "Review form submissions for this website."}
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gap: "1.25rem" }}>
        <div className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>API ID</th>
                <th>Fields</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {forms.map((f) => (
                <tr key={f.id}>
                  <td>{f.name}</td>
                  <td>
                    <code>{f.apiId}</code>
                  </td>
                  <td>{f.fields?.length ?? 0}</td>
                  <td>
                    <span
                      className="badge"
                      data-status={f.enabled ? "published" : "draft"}
                    >
                      {f.enabled ? "enabled" : "disabled"}
                    </span>
                  </td>
                  <td>
                    <div className="actions">
                      {canManage && (
                        <Link href={`/forms/${f.apiId}`}>Manage</Link>
                      )}
                      <Link href={`/forms/${f.apiId}/submissions`}>Inbox</Link>
                    </div>
                  </td>
                </tr>
              ))}
              {forms.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    No forms yet
                    {canManage ? ". Create one below or run the seed." : "."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {error && (
            <p style={{ color: "var(--danger)", margin: "0.75rem 0 0" }}>
              {error}
            </p>
          )}
        </div>

        {canManage && (
          <div className="panel">
            <h2
              style={{
                marginTop: 0,
                fontFamily: "var(--font-display)",
                fontWeight: 500,
              }}
            >
              New form
            </h2>
            <CreateFormForm />
          </div>
        )}
      </div>
    </>
  );
}
