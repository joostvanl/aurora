import type { WebsiteRole } from "@prisma/client";
import { prisma } from "../db.js";
import type { AuthUser } from "./password.js";

export type LiveMembership = {
  role: WebsiteRole;
  websiteId: string;
  websiteName: string;
  siteKey: string;
};

/**
 * Load current Membership for a real user + website claim.
 * Returns null when the user no longer belongs to that website.
 */
export async function loadLiveMembership(
  userId: string,
  websiteId: string,
): Promise<LiveMembership | null> {
  if (!userId || userId.startsWith("token:")) return null;

  const membership = await prisma.membership.findUnique({
    where: { userId_websiteId: { userId, websiteId } },
    include: {
      website: { select: { id: true, name: true, siteKey: true } },
    },
  });
  if (!membership) return null;

  return {
    role: membership.role,
    websiteId: membership.website.id,
    websiteName: membership.website.name,
    siteKey: membership.website.siteKey,
  };
}

/** Apply live membership fields onto the request user (mutates). */
export function applyLiveMembership(user: AuthUser, live: LiveMembership) {
  user.role = live.role;
  user.websiteId = live.websiteId;
  user.websiteName = live.websiteName;
  user.siteKey = live.siteKey;
}
