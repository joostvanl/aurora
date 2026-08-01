"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { WebsiteRole } from "@cms/shared";
import { getBrowserAdminClient } from "@/lib/auth";

type MemberRow = {
  id: string;
  role: WebsiteRole;
  user: { id: string; email: string; name: string | null };
  createdAt: string;
};

export function MembersManager() {
  const router = useRouter();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<WebsiteRole>("editor");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function load() {
    const items = await getBrowserAdminClient().listMembers();
    setMembers(items as MemberRow[]);
  }

  useEffect(() => {
    void load().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load members"),
    );
  }, []);

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setInfo(null);
    try {
      const res = await getBrowserAdminClient().addMember({
        email,
        name: name.trim() || undefined,
        role,
        password: password.trim() || undefined,
      });
      if (res.temporaryPassword) {
        setInfo(
          `User created. Temporary password: ${res.temporaryPassword} (share securely)`,
        );
      }
      setEmail("");
      setName("");
      setPassword("");
      setRole("editor");
      await load();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setPending(false);
    }
  }

  async function changeRole(id: string, next: WebsiteRole) {
    setPending(true);
    setError(null);
    try {
      await getBrowserAdminClient().updateMember(id, { role: next });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Remove this member from the website?")) return;
    setPending(true);
    try {
      await getBrowserAdminClient().removeMember(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    } finally {
      setPending(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      <div className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>
                  <div>{m.user.name || m.user.email}</div>
                  <div className="muted" style={{ fontSize: "0.8rem" }}>
                    {m.user.email}
                  </div>
                </td>
                <td>
                  <select
                    value={m.role}
                    disabled={pending}
                    onChange={(e) =>
                      void changeRole(m.id, e.target.value as WebsiteRole)
                    }
                  >
                    <option value="editor">editor</option>
                    <option value="builder">builder</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td>
                  <button
                    className="btn btn-danger"
                    type="button"
                    disabled={pending}
                    onClick={() => void remove(m.id)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {members.length === 0 && (
              <tr>
                <td colSpan={3} className="empty">
                  No members.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {error && (
          <p style={{ color: "var(--danger)", margin: "0.75rem 0 0" }}>{error}</p>
        )}
        {info && (
          <p style={{ color: "var(--accent)", margin: "0.75rem 0 0" }}>{info}</p>
        )}
      </div>

      <div className="panel">
        <h2
          style={{
            marginTop: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 500,
          }}
        >
          Add member
        </h2>
        <form className="form" onSubmit={addMember}>
          <div className="field">
            <label htmlFor="mem-email">Email</label>
            <input
              id="mem-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="mem-name">Name (new users)</label>
            <input
              id="mem-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="mem-pass">Password (required for new users)</label>
            <input
              id="mem-pass"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
            />
          </div>
          <div className="field">
            <label htmlFor="mem-role">Role</label>
            <select
              id="mem-role"
              value={role}
              onChange={(e) => setRole(e.target.value as WebsiteRole)}
            >
              <option value="editor">editor — content & form inbox</option>
              <option value="builder">builder — schema + content (no members/AI)</option>
              <option value="admin">admin — everything</option>
            </select>
          </div>
          <button className="btn" type="submit" disabled={pending}>
            Add member
          </button>
        </form>
      </div>
    </div>
  );
}
