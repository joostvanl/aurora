import type { WebsiteRole } from "@prisma/client";
import { prisma } from "../db.js";
import {
  createSiteKey,
  signAccessToken,
  toAuthUser,
  type AuthUser,
} from "./password.js";

export type WebsiteSummary = {
  id: string;
  name: string;
  siteKey: string;
  role: WebsiteRole;
};

export async function listUserWebsites(userId: string): Promise<WebsiteSummary[]> {
  const rows = await prisma.membership.findMany({
    where: { userId },
    include: { website: true },
    orderBy: { website: { name: "asc" } },
  });
  return rows.map((m) => ({
    id: m.website.id,
    name: m.website.name,
    siteKey: m.website.siteKey,
    role: m.role,
  }));
}

export async function getMembership(userId: string, websiteId: string) {
  return prisma.membership.findUnique({
    where: { userId_websiteId: { userId, websiteId } },
    include: { website: true },
  });
}

export async function createWebsiteWithAdmin(input: {
  userId: string;
  name: string;
  siteKey?: string;
}) {
  return prisma.website.create({
    data: {
      name: input.name.trim(),
      siteKey: input.siteKey ?? createSiteKey(),
      memberships: {
        create: {
          userId: input.userId,
          role: "admin",
        },
      },
    },
  });
}

export function publicUser(
  user: { id: string; email: string; name: string | null; createdAt?: Date },
  ctx?: {
    websiteId?: string | null;
    websiteName?: string | null;
    role?: WebsiteRole | null;
    siteKey?: string | null;
  },
) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    websiteId: ctx?.websiteId ?? null,
    websiteName: ctx?.websiteName ?? null,
    role: ctx?.role ?? null,
    siteKey: ctx?.siteKey ?? null,
    ...(user.createdAt
      ? { createdAt: user.createdAt.toISOString() }
      : {}),
  };
}

export async function issueAuthResponse(user: {
  id: string;
  email: string;
  name: string | null;
  createdAt?: Date;
}, preferredWebsiteId?: string) {
  const websites = await listUserWebsites(user.id);
  const preferred =
    (preferredWebsiteId
      ? websites.find((w) => w.id === preferredWebsiteId)
      : null) ?? (websites.length === 1 ? websites[0] : null);

  const authUser = toAuthUser({
    id: user.id,
    email: user.email,
    name: user.name,
    websiteId: preferred?.id ?? null,
    websiteName: preferred?.name ?? null,
    role: preferred?.role ?? null,
    siteKey: preferred?.siteKey ?? null,
  });

  const token = await signAccessToken(authUser);

  return {
    token,
    user: publicUser(user, authUser),
    websites,
    needsWebsiteSelection: !preferred && websites.length > 1,
  };
}

export async function authUserForWebsite(
  user: { id: string; email: string; name: string | null },
  websiteId: string,
): Promise<AuthUser> {
  const membership = await getMembership(user.id, websiteId);
  if (!membership) {
    throw Object.assign(new Error("Not a member of this website"), {
      statusCode: 403,
    });
  }
  return toAuthUser({
    id: user.id,
    email: user.email,
    name: user.name,
    websiteId: membership.website.id,
    websiteName: membership.website.name,
    role: membership.role,
    siteKey: membership.website.siteKey,
  });
}
