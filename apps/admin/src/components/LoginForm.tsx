"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  clearSession,
  getBrowserAuthClient,
  getStoredToken,
  storeSession,
  syncSessionCookie,
} from "@/lib/auth";

export function LoginForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [websiteName, setWebsiteName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (getStoredToken()) {
      router.replace("/");
    }
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const client = getBrowserAuthClient();
      const res =
        mode === "register"
          ? await client.register({
              email,
              password,
              name: name.trim() || undefined,
              websiteName: websiteName.trim() || undefined,
            })
          : await client.login({ email, password });

      storeSession(res.token, res.user);
      await syncSessionCookie(res.token);

      if (res.needsWebsiteSelection) {
        router.replace("/select-website");
      } else {
        router.replace("/");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="form" onSubmit={onSubmit}>
      {mode === "register" && (
        <>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="field">
            <label htmlFor="websiteName">Website name</label>
            <input
              id="websiteName"
              value={websiteName}
              onChange={(e) => setWebsiteName(e.target.value)}
              placeholder="My website"
            />
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={mode === "register" ? 8 : 1}
          autoComplete={
            mode === "register" ? "new-password" : "current-password"
          }
        />
      </div>
      {error && <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p>}
      <button className="btn" type="submit" disabled={pending}>
        {pending
          ? "Please wait…"
          : mode === "register"
            ? "Create account"
            : "Sign in"}
      </button>
    </form>
  );
}

export function logout() {
  clearSession();
  document.cookie = "aurora_cms_token=; path=/; max-age=0";
}
