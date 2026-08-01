# Frontend playbook

Build a frontend against Aurora in this order.

## 0. Optional: provision the CMS first

If you are a **site-building agent** creating both the content model and the frontend, configure the tenant with the [Management API](./management-api.md) (`POST /api/v1/admin/provision` + API token) **before** wiring the UI. Save the account `siteKey` for step 2.

## 1. Prerequisites

- API running locally (`http://localhost:4000`) or production (`https://aurora-api.joostvanleeuwaarden.com`)
- A tenant with published content (seed demo, your account, or provisioned model)
- That tenant’s **`siteKey`**
- Local frontends: localhost / 127.0.0.1 any port are CORS-allowed out of the box

## 2. Configure env

```bash
# Local
NEXT_PUBLIC_CMS_API_URL=http://localhost:4000
NEXT_PUBLIC_CMS_SITE_KEY=demo-site-key

# Production demo
# NEXT_PUBLIC_CMS_API_URL=https://aurora-api.joostvanleeuwaarden.com
# NEXT_PUBLIC_CMS_SITE_KEY=demo-site-key
```

For write access in CI/agents (never in the browser):

```bash
CMS_MANAGEMENT_TOKEN=aur_live_demo_write_token_change_me
```

## 3. Discover the schema

```http
GET /api/v1/content-types
x-site-key: …
```

Note each type’s `apiId`, field `apiId`s, and `settings.contentFormat`. Do not invent field names.

Optional: `GET /api/v1/content-types/:apiId/schema.json` or `GET /api/v1/openapi.json`.

## 4. Fetch patterns

| Need | Call |
|------|------|
| Chrome + home (one call) | `GET /api/v1/bootstrap` |
| Global chrome | `site_settings` → `default`; `nav_item` list `?limit=50&sort=sortOrder&order=asc` |
| Landing | `page` → `home` |
| Collection | `GET .../{type}/entries?limit=50&sort=sortOrder` (when type has sortOrder) |
| Detail | `GET .../{type}/entries/{slug}` |

Always read copy from `entry.fields.<apiId>`. Render richtext as **HTML**; markdown only when `contentFormat` is `markdown`.

Canonical starter: [`examples/minimal-frontend/index.html`](../examples/minimal-frontend/index.html).

## 5. Routing convention (this product site)

| Path | Source |
|------|--------|
| `/` | `page/home` + lists |
| `/docs`, `/docs/[slug]` | `doc` entries (Markdown `body`) |
| `/services`, `/services/[slug]` | `service` |
| `/work`, `/work/[slug]` | `project` |
| `/blog`, `/blog/[slug]` | `post` (guides) |
| `/blogs`, `/blogs/[slug]` | `blog` (articles) |
| `/team`, `/team/[slug]` | `team_member` |
| `/faq` | `faq` |
| `/pricing`, `/about`, `/contact` | `page` |
| `/[slug]` | fallback `page` by slug |

You may invent different routes; keep API ids stable.

## 6. Publishing checklist

- Content must be **published** in admin or it will 404 / empty-list.
- After edits, republish if status was draft.
- Wrong `siteKey` → empty or 401.

## 7. Recommended UX for empty tenants

New accounts have no types. Show a clear empty state: “No content for this site key yet.”

## 8. Optional typed client

See [typed-client.md](./typed-client.md) for `@cms/shared` `CmsClient`.
