# Public Content API

Base URLs:

| Environment | API |
|-------------|-----|
| Local | `http://localhost:4000` |
| Production (demo) | `https://aurora-api.joostvanleeuwaarden.com` |

**Every content request requires:**

```http
x-site-key: <your-account-site-key>
```

Demo seed default: `demo-site-key`.

Only **published** entries are returned by default. Drafts appear only with a short-lived `previewToken` (see below).

Public responses include header `X-Aurora-Api-Version: 1`.

Machine-readable contract: [`GET /api/v1/openapi.json`](#get-apiv1openapijson).

---

## `GET /health`

No auth.

```json
{ "status": "ok" }
```

---

## `GET /api/v1/openapi.json`

No site key. OpenAPI 3 document for the public surface.

---

## `GET /api/v1/cors-check`

No site key. Diagnose whether an Origin would be allowed.

| Query | Notes |
|-------|-------|
| `origin` | Optional; defaults to request `Origin` header |

```json
{ "allowed": true, "origin": "http://localhost:5173", "hint": "…" }
```

**Local DX:** `http://localhost:*` and `http://127.0.0.1:*` are always allowed. Production frontends must be listed on the website (`allowedOrigins`) or in `CORS_ORIGINS`.

### Local proxy (when Cloudflare / browser still blocks)

```bash
# Example: proxy API under your Next/Vite origin
# next.config.js rewrites → http://localhost:4000/api/:path*
```

Or call the API from a **server** component / SSR fetch (no browser Origin).

---

## `GET /api/v1/locales`

Returns `{ defaultLocale, locales: [{ code, label, flag }] }` for language switchers (BCP-47 + flag emoji).

---

## `GET /api/v1/bootstrap`

One roundtrip for site chrome + home. Optional query: `locale` (defaults to website `defaultLocale`).

```json
{
  "siteSettings": { /* FlatEntry or null */ },
  "nav": [ /* FlatEntry[] sorted by sortOrder */ ],
  "primaryPage": { /* page/home or null */ },
  "locale": "en-US"
}
```

Conventions: `site_settings` slug `default`, `nav_item` list, `page` slug `home`. Missing types → `null` / `[]` (not 404).

---

## `GET /api/v1/content-types`

Lists all content types for the tenant (with field definitions).

Each field includes `settings.contentFormat`: `html` | `markdown` | `plain`.

- `richtext` → always `html` (TipTap HTML)
- `textarea` / `text` → `plain` unless overridden (docs `body` is `markdown`)

Use this to **discover** the schema before hard-coding assumptions.

---

## `GET /api/v1/content-types/:apiId`

One content type by `apiId`.  
404 + `code: CONTENT_TYPE_NOT_FOUND` if missing for this site key.

---

## `GET /api/v1/content-types/:apiId/schema.json`

JSON Schema describing `entry.fields` for codegen / agents.

---

## `GET /api/v1/content-types/:apiId/entries`

List published entries.

| Query | Type | Default | Notes |
|-------|------|---------|-------|
| `limit` | 1–100 | `20` | Raise for nav / full catalogs |
| `offset` | ≥0 | `0` | Pagination |
| `slug` | string | — | Optional exact slug filter |
| `locale` | BCP-47 | website `defaultLocale` | Exact locale (e.g. `nl-NL`) |
| `sort` | `publishedAt` \| `createdAt` \| `updatedAt` \| `sortOrder` | `publishedAt` | `sortOrder` uses field apiId `sortOrder` when present |
| `order` | `asc` \| `desc` | `desc` (`asc` when `sort=sortOrder`) | |
| `field` | string | — | Field `apiId` to filter on (requires `in`) |
| `in` | string | — | Comma-separated match values for `field` (max 50). Equality / IN against the field’s stored value |

**Field filter:** `field` + `in` select entries whose named content-type field equals any of the values.

- Supported types: `text`, `textarea`, `slug`, `username`, `relation`, `relations`, `number`, `boolean`, `datetime`.
- `relation` matches the related entry **slug**; `relations` matches if the stored slug array contains any requested value.
- Unsupported types (`richtext`, `media`, `password`), unknown `field`, empty `in`, or `field`/`in` used alone → `400` `VALIDATION_FAILED`.
- Example: `?field=category&in=news,sports`

Response: `{ items, total, limit, offset, sort, order }` — see [response-shapes.md](./response-shapes.md). `total` reflects the filtered set when `field`/`in` are used.

Empty tenant / no matches → `200` with `items: []` (not 401). Wrong site key → `401` + `SITE_KEY_INVALID`.

---

## `GET /api/v1/content-types/:apiId/entries/:slug`

One published entry by slug.

| Query | Notes |
|-------|-------|
| `locale` | BCP-47; defaults to website `defaultLocale` |
| `previewToken` | Optional; minted from admin — allows that draft entry |

Examples:

| Resource | Path |
|----------|------|
| Home page | `/api/v1/content-types/page/entries/home` |
| Site settings | `/api/v1/content-types/site_settings/entries/default` |
| A post | `/api/v1/content-types/post/entries/hello-aurora` |

404 + `ENTRY_NOT_FOUND` if not found / not published (and no valid preview).

---

## Media & `/uploads`

- Media field values are preferably `{ "url", "alt", "width", "height", "mimeType" }`.
- Legacy plain URL strings still work; public list/get normalize toward objects when possible.
- Files are served at `/uploads/{websiteId}/…` with `Cache-Control: public, max-age=31536000, immutable`.
- `/uploads` uses the same CORS rules as the API.

---

## Errors

```json
{
  "message": "Human readable",
  "code": "ENTRY_NOT_FOUND",
  "issues": [{ "path": ["email"], "code": "required", "message": "…" }]
}
```

Stable codes include: `SITE_KEY_MISSING`, `SITE_KEY_INVALID`, `ENTRY_NOT_FOUND`, `CONTENT_TYPE_NOT_FOUND`, `FORM_NOT_FOUND`, `ORIGIN_NOT_ALLOWED`, `RATE_LIMITED`, `VALIDATION_FAILED`.

---

## curl cookbook

### Local

```bash
SITE=demo-site-key
API=http://localhost:4000

curl -s "$API/health"
curl -s "$API/api/v1/cors-check?origin=http://localhost:5173"
curl -s "$API/api/v1/bootstrap" -H "x-site-key: $SITE"
curl -s "$API/api/v1/content-types" -H "x-site-key: $SITE"
curl -s "$API/api/v1/content-types/nav_item/entries?limit=50&sort=sortOrder&order=asc" \
  -H "x-site-key: $SITE"
curl -s "$API/api/v1/content-types/page/entries/home" -H "x-site-key: $SITE"
```

### Production

```bash
SITE=demo-site-key
API=https://aurora-api.joostvanleeuwaarden.com

curl -s "$API/api/v1/bootstrap" -H "x-site-key: $SITE"
curl -s "$API/api/v1/content-types/faq/entries?sort=sortOrder" -H "x-site-key: $SITE"
```

## Minimal HTML+JS

See [`examples/minimal-frontend/index.html`](../examples/minimal-frontend/index.html).

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

### Richtext rendering

Read `fields[].settings.contentFormat` from the content-type schema:

- `html` → sanitize + `innerHTML` / framework HTML component
- `markdown` → Markdown renderer
- `plain` → text / `\n\n` → paragraphs

Do not guess format from string content when the schema is available.

## Env for frontends

```bash
# Local
NEXT_PUBLIC_CMS_API_URL=http://localhost:4000
NEXT_PUBLIC_CMS_SITE_KEY=demo-site-key

# Production demo
NEXT_PUBLIC_CMS_API_URL=https://aurora-api.joostvanleeuwaarden.com
NEXT_PUBLIC_CMS_SITE_KEY=demo-site-key
```

If your frontend origin is not local and not already allowed, add it under Admin → **Website** → **Allowed frontend origins**.

---

## Forms (public write)

See **[forms.md](./forms.md)**. Options are always `[{ value, label }]`. Submit validation errors return `code: VALIDATION_FAILED` with `issues[]`.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/v1/forms/:apiId` | Schema for an enabled form |
| POST | `/api/v1/forms/:apiId/submit` | Body `{ fields: { … } }` — rate limited |

Still requires `x-site-key`. This is the only public **write** surface in Aurora V1.
