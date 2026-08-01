"use client";

import type { AuthUser } from "@cms/shared";
import { createCmsClient } from "@cms/shared";

const TOKEN_KEY = "aurora_cms_token";
const USER_KEY = "aurora_cms_user";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function storeSession(token: string, user: AuthUser) {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function setSessionCookie(token: string) {
  document.cookie = `aurora_cms_token=${token}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
}

export async function syncSessionCookie(token: string) {
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    throw new Error("Failed to sync studio session");
  }
  setSessionCookie(token);
}

export function clearSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export function getBrowserAdminClient() {
  const baseUrl = process.env.NEXT_PUBLIC_CMS_API_URL ?? "http://localhost:4000";
  const token = getStoredToken();
  return createCmsClient({ baseUrl, token });
}

export function getBrowserAuthClient() {
  const baseUrl = process.env.NEXT_PUBLIC_CMS_API_URL ?? "http://localhost:4000";
  return createCmsClient({ baseUrl });
}
