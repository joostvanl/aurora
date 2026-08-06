import {
  createCmsClient,
  type AuthUser,
  type CmsClient,
  type WebsiteDetails,
  type WebsiteMembership,
  type WebsiteRole,
} from "@cms/shared";

export type McpAuthMode = "user_pat" | "website_token";

export type McpContext = {
  apiUrl: string;
  /** PAT (aur_u_…) or legacy website token (aur_…) — kept for re-select. */
  userToken: string;
  /** JWT after select-website; null in legacy website-token mode or before select. */
  sessionToken: string | null;
  authMode: McpAuthMode;
  client: CmsClient;
  user: AuthUser | null;
  /** Mutable: refreshed by select_website / get_website / update_website */
  website: WebsiteDetails | null;
  role: WebsiteRole | null;
  memberships: WebsiteMembership[];
  /** True when a site key is set and matches the active website */
  publicEnabled: boolean;
};

export function requireActiveWebsite(ctx: McpContext): WebsiteDetails {
  if (!ctx.website) {
    throw new Error(
      "No active website. Call list_websites then select_website with a websiteId.",
    );
  }
  return ctx.website;
}

/** Keep client Bearer = session JWT when present, else PAT / site token. */
export function syncClientAuth(ctx: McpContext) {
  ctx.client.setToken(ctx.sessionToken ?? ctx.userToken);
}

function resolvePublicEnabled(website: WebsiteDetails | null): boolean {
  const siteKeyEnv = process.env.CMS_SITE_KEY?.trim();
  if (!siteKeyEnv || !website) return false;
  return siteKeyEnv === website.siteKey;
}

function applySiteKey(ctx: McpContext) {
  const envKey = process.env.CMS_SITE_KEY?.trim();
  if (envKey) {
    ctx.client.setSiteKey(envKey);
    ctx.publicEnabled = resolvePublicEnabled(ctx.website);
    return;
  }
  if (ctx.website?.siteKey) {
    ctx.client.setSiteKey(ctx.website.siteKey);
    ctx.publicEnabled = true;
    return;
  }
  ctx.client.setSiteKey(null);
  ctx.publicEnabled = false;
}

/**
 * Select a website using the user PAT, then switch management calls to the JWT.
 */
export async function selectWebsiteOnContext(
  ctx: McpContext,
  websiteId: string,
): Promise<void> {
  if (ctx.authMode === "website_token") {
    throw new Error(
      "Website-scoped aur_… tokens cannot switch websites. Use a personal access token (CMS_USER_TOKEN / aur_u_…).",
    );
  }

  ctx.client.setToken(ctx.userToken);
  const res = await ctx.client.selectWebsite({ websiteId });
  ctx.sessionToken = res.token;
  ctx.user = res.user;
  ctx.role = res.user.role ?? null;
  ctx.memberships = res.websites;
  syncClientAuth(ctx);

  const website = await ctx.client.getWebsite();
  ctx.website = website;
  applySiteKey(ctx);

  console.error(
    `[aurora-mcp] Active website id=${website.id} name=${JSON.stringify(website.name)} role=${ctx.role} publicRead=${ctx.publicEnabled}`,
  );
}

export function whoamiSnapshot(ctx: McpContext) {
  return {
    authMode: ctx.authMode,
    userId: ctx.user?.id ?? null,
    email: ctx.user?.email ?? null,
    name: ctx.user?.name ?? null,
    role: ctx.role,
    websiteId: ctx.website?.id ?? null,
    websiteName: ctx.website?.name ?? null,
    siteKey: ctx.website?.siteKey ?? null,
    publicReadEnabled: ctx.publicEnabled,
    apiUrl: ctx.apiUrl,
    locales: ctx.website?.locales ?? null,
    defaultLocale: ctx.website?.defaultLocale ?? null,
    membershipCount: ctx.memberships.length,
  };
}

/**
 * Fail-fast auth gate.
 * Prefer CMS_USER_TOKEN (aur_u_…); legacy CMS_MANAGEMENT_TOKEN (aur_…) still supported.
 */
export async function createMcpContext(): Promise<McpContext> {
  const apiUrl = (process.env.CMS_API_URL ?? "").trim().replace(/\/$/, "");
  if (!apiUrl) {
    throw new Error(
      "Missing required env CMS_API_URL. Set CMS_API_URL and CMS_USER_TOKEN (aur_u_… personal access token).",
    );
  }

  const userPat = process.env.CMS_USER_TOKEN?.trim() || "";
  const legacyToken = process.env.CMS_MANAGEMENT_TOKEN?.trim() || "";
  const token = userPat || legacyToken;
  if (!token) {
    throw new Error(
      "Missing CMS_USER_TOKEN (preferred, aur_u_…) or CMS_MANAGEMENT_TOKEN (legacy website aur_… token).",
    );
  }

  const authMode: McpAuthMode = token.startsWith("aur_u_")
    ? "user_pat"
    : "website_token";

  if (userPat && !userPat.startsWith("aur_u_")) {
    console.error(
      "[aurora-mcp] Warning: CMS_USER_TOKEN should start with aur_u_. Falling back to website-token bootstrap if applicable.",
    );
  }
  if (authMode === "website_token" && !token.startsWith("aur_")) {
    console.error(
      "[aurora-mcp] Warning: Token does not start with aur_ / aur_u_. Prefer CMS_USER_TOKEN from Studio → Settings → Personal access tokens.",
    );
  }

  const client = createCmsClient({
    baseUrl: apiUrl,
    token,
    siteKey: process.env.CMS_SITE_KEY?.trim() || null,
  });

  const ctx: McpContext = {
    apiUrl,
    userToken: token,
    sessionToken: null,
    authMode,
    client,
    user: null,
    website: null,
    role: null,
    memberships: [],
    publicEnabled: false,
  };

  if (authMode === "website_token") {
    await bootstrapLegacyWebsiteToken(ctx);
  } else {
    await bootstrapUserPat(ctx);
  }

  return ctx;
}

async function bootstrapLegacyWebsiteToken(ctx: McpContext): Promise<void> {
  let website: WebsiteDetails;
  try {
    website = await ctx.client.getWebsite();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Management token rejected by ${ctx.apiUrl}/api/v1/admin/website: ${msg}. ` +
        `Create a website token in Studio → Utilities → API tokens, or use CMS_USER_TOKEN.`,
    );
  }

  const pin = process.env.CMS_WEBSITE_ID?.trim();
  if (pin && pin !== website.id) {
    throw new Error(
      `CMS_WEBSITE_ID pin mismatch: env=${pin} tokenWebsite=${website.id} (${website.name}). ` +
        `Refuse to start to avoid cross-tenant mistakes.`,
    );
  }

  ctx.website = website;
  ctx.role = "admin";
  applySiteKey(ctx);

  if (process.env.CMS_SITE_KEY?.trim() && !ctx.publicEnabled) {
    throw new Error(
      `CMS_SITE_KEY does not match the website bound to the management token ` +
        `(website=${website.name}). Public tools disabled; refusing start.`,
    );
  }

  console.error(
    `[aurora-mcp] Legacy website token mode id=${website.id} name=${JSON.stringify(website.name)} publicRead=${ctx.publicEnabled}`,
  );
}

async function bootstrapUserPat(ctx: McpContext): Promise<void> {
  let me: Awaited<ReturnType<CmsClient["me"]>>;
  try {
    me = await ctx.client.me();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `User token rejected by ${ctx.apiUrl}/api/v1/auth/me: ${msg}. ` +
        `Create a personal access token in Studio → Settings → Personal access tokens.`,
    );
  }

  ctx.user = me.user;
  ctx.memberships = me.websites;

  const preferred = process.env.CMS_WEBSITE_ID?.trim();
  let targetId: string | null = null;
  if (preferred) {
    if (!me.websites.some((w) => w.id === preferred)) {
      throw new Error(
        `CMS_WEBSITE_ID=${preferred} is not among your memberships. Call list_websites after start, or fix the id.`,
      );
    }
    targetId = preferred;
  } else if (me.websites.length === 1) {
    targetId = me.websites[0]!.id;
  } else if (me.user.websiteId) {
    targetId = me.user.websiteId;
  }

  if (targetId) {
    await selectWebsiteOnContext(ctx, targetId);
  } else {
    applySiteKey(ctx);
    console.error(
      `[aurora-mcp] Authenticated user=${me.user.email} with ${me.websites.length} website(s); no active website — call select_website.`,
    );
  }
}
