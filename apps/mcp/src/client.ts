import {
  createCmsClient,
  type CmsClient,
  type WebsiteDetails,
} from "@cms/shared";

export type McpContext = {
  apiUrl: string;
  client: CmsClient;
  /** Mutable: refreshed by get_website / update_website */
  website: WebsiteDetails;
  /** True when CMS_SITE_KEY is set and matches website.siteKey */
  publicEnabled: boolean;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required env ${name}. Set CMS_API_URL and CMS_MANAGEMENT_TOKEN (website-scoped aur_… token).`,
    );
  }
  return value;
}

/**
 * Fail-fast auth gate: management token required; optional website/site-key pins.
 * Authorization remains enforced by the Management API (token → websiteId).
 */
export async function createMcpContext(): Promise<McpContext> {
  const apiUrl = requireEnv("CMS_API_URL").replace(/\/$/, "");
  const token = requireEnv("CMS_MANAGEMENT_TOKEN");

  if (!token.startsWith("aur_")) {
    console.error(
      "[aurora-mcp] Warning: CMS_MANAGEMENT_TOKEN does not start with aur_. Prefer a website API token.",
    );
  }

  const client = createCmsClient({
    baseUrl: apiUrl,
    token,
    siteKey: process.env.CMS_SITE_KEY?.trim() || null,
  });

  let website: WebsiteDetails;
  try {
    website = await client.getWebsite();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Management token rejected by ${apiUrl}/api/v1/admin/website: ${msg}. ` +
        `Create a token in Admin → API tokens for the target website.`,
    );
  }

  const pin = process.env.CMS_WEBSITE_ID?.trim();
  if (pin && pin !== website.id) {
    throw new Error(
      `CMS_WEBSITE_ID pin mismatch: env=${pin} tokenWebsite=${website.id} (${website.name}). ` +
        `Refuse to start to avoid cross-tenant mistakes.`,
    );
  }

  const siteKeyEnv = process.env.CMS_SITE_KEY?.trim();
  let publicEnabled = false;
  if (siteKeyEnv) {
    if (siteKeyEnv !== website.siteKey) {
      throw new Error(
        `CMS_SITE_KEY does not match the website bound to the management token ` +
          `(website=${website.name}). Public tools disabled; refusing start.`,
      );
    }
    publicEnabled = true;
  }

  console.error(
    `[aurora-mcp] Authenticated website id=${website.id} name=${JSON.stringify(website.name)} publicRead=${publicEnabled}`,
  );

  return { apiUrl, client, website, publicEnabled };
}
