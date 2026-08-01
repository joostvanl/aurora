import type { WebsiteRole } from "@prisma/client";

const RANK: Record<WebsiteRole, number> = {
  editor: 1,
  builder: 2,
  admin: 3,
};

export function roleAtLeast(
  role: WebsiteRole | null | undefined,
  minimum: WebsiteRole,
): boolean {
  if (!role) return false;
  return RANK[role] >= RANK[minimum];
}

/** What each role may do in the studio / admin API. */
export const RolePermission = {
  /** Entries + form submissions inbox */
  content: "editor" as WebsiteRole,
  /** Content types, form schemas, API tokens, provision */
  schema: "builder" as WebsiteRole,
  /** Members + AI config */
  admin: "admin" as WebsiteRole,
};
