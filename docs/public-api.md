# Public Content API

Base URL (local): `http://localhost:4000`

**Every content request requires:**

```http
x-site-key: <your-account-site-key>
```

Demo seed default: `demo-site-key`.

Only **published** entries are returned. Drafts never appear here.

---

## `GET /health`

No auth.

```json
{ "status": "ok" }
```

---

## `GET /api/v1/content-types`

Lists all content types for the tenant (with field definitions).

Use this to **discover** the schema before hard-coding assumptions.

---

## `GET /api/v1/content-types/:apiId`

One content type by `apiId` (e.g. `page`, `post`).  
404 if missing for this site key.

---

## `GET /api/v1/content-types/:apiId/entries`

List published entries.

| Query | Type | Default | Notes |
|-------|------|---------|-------|
| `limit` | 1–100 | `20` | Raise for nav / full catalogs |
| `offset` | ≥0 | `0` | Pagination |
| `slug` | string | — | Optional exact slug filter |

**Order:** `publishedAt` desc, then `createdAt` desc.  
**Not sorted by** `fields.sortOrder` — sort in your frontend when needed.

Response: `{ items, total, limit, offset }` — see [response-shapes.md](./response-shapes.md).

---

## `GET /api/v1/content-types/:apiId/entries/:slug`

One published entry by slug.

Examples:

| Resource | Path |
|----------|------|
| Home page | `/api/v1/content-types/page/entries/home` |
| Site settings | `/api/v1/content-types/site_settings/entries/default` |
| A post | `/api/v1/content-types/post/entries/hello-aurora` |

404 if not found or not published.

---

## curl cookbook

```bash
SITE=demo-site-key
API=http://localhost:4000

curl -s "$API/health"

curl -s "$API/api/v1/content-types" \
  -H "x-site-key: $SITE"

curl -s "$API/api/v1/content-types/nav_item/entries?limit=50" \
  -H "x-site-key: $SITE"

curl -s "$API/api/v1/content-types/page/entries/home" \
  -H "x-site-key: $SITE"

curl -s "$API/api/v1/content-types/post/entries?limit=10" \
  -H "x-site-key: $SITE"
```

## Fetch (browser / Node)

```js
const API = process.env.NEXT_PUBLIC_CMS_API_URL;
const SITE_KEY = process.env.NEXT_PUBLIC_CMS_SITE_KEY;

async function getEntry(apiId, slug) {
  const res = await fetch(
    `${API}/api/v1/content-types/${apiId}/entries/${slug}`,
    { headers: { "x-site-key": SITE_KEY } },
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

## Env for frontends

```bash
NEXT_PUBLIC_CMS_API_URL=http://localhost:4000
NEXT_PUBLIC_CMS_SITE_KEY=demo-site-key
```

If your frontend origin is not already allowed for the studio (`CORS_ORIGINS`), add it on the website in Admin → **Website** → **Allowed frontend origins**, or `PATCH /api/v1/admin/website` with `{ "allowedOrigins": ["https://your-app.example"] }`.

---

## Forms (public write)

Forms are separate from content entries. See **[forms.md](./forms.md)**.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/forms/:apiId` | Schema for an enabled form |
| POST | `/api/v1/forms/:apiId/submit` | Body `{ fields: { … } }` — rate limited |

Still requires `x-site-key`. This is the only public **write** surface in Aurora V1.
