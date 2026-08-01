# Frontend playbook

Build a frontend against Aurora in this order.

## 0. Optional: provision the CMS first

If you are a **site-building agent** creating both the content model and the frontend, configure the tenant with the [Management API](./management-api.md) (`POST /api/v1/admin/provision` + API token) **before** wiring the UI. Save the account `siteKey` for step 2.

## 1. Prerequisites

- API running (`http://localhost:4000`)
- A tenant with published content (seed demo, your account, or provisioned model)
- That tenant’s **`siteKey`**

## 2. Configure env

```bash
NEXT_PUBLIC_CMS_API_URL=http://localhost:4000
NEXT_PUBLIC_CMS_SITE_KEY=demo-site-key
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

Note each type’s `apiId` and field `apiId`s. Do not invent field names.

## 4. Fetch patterns

| Need | Call |
|------|------|
| Global chrome | `site_settings` → `default`; `nav_item` list (`limit=50`), sort by `sortOrder` |
| Landing | `page` → `home` |
| Collection | `GET .../{type}/entries?limit=50` |
| Detail | `GET .../{type}/entries/{slug}` |

Always read copy from `entry.fields.<apiId>`.

## 5. Routing convention (this product site)

| Path | Source |
|------|--------|
| `/` | `page/home` + lists |
| `/docs`, `/docs/[slug]` | Markdown in repo `docs/` |
| `/services`, `/services/[slug]` | `service` |
| `/work`, `/work/[slug]` | `project` |
| `/blog`, `/blog/[slug]` | `post` |
| `/team`, `/team/[slug]` | `team_member` |
| `/faq` | `faq` |
| `/about`, `/contact` | `page` |
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
