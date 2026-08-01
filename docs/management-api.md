# Management API (write from outside)

Use this when a **site-building agent** or automation must create and edit **content types** and **content** for an Aurora account.

Public frontends use only `x-site-key` (read). Management uses a **Bearer token** scoped to one account.

## Credentials (do not mix them up)

| Credential | Header | Access |
|------------|--------|--------|
| **Site key** | `x-site-key` | Public **read** of published content |
| **API token** (`aur_…`) | `Authorization: Bearer aur_…` | **Write** management API (preferred for agents) |
| **JWT** (from login) | `Authorization: Bearer eyJ…` | Same write API (expires in 7 days) |

`siteKey` never grants write access.  
API tokens / JWT never work as `x-site-key`.

### Demo tenant (local seed)

| Item | Value |
|------|-------|
| Site key (public read) | `demo-site-key` |
| Management API token | `aur_live_demo_write_token_change_me` |
| Admin login | `demo@aurora.local` / `demo-demo-demo` |

Change or revoke the demo token in production.

---

## Auth flows for agents

### A — Prefer API token (long-lived)

1. Human logs into Admin or uses login once.
2. `POST /api/v1/admin/tokens` with JWT → receive `aur_…` **once**.
3. Agent stores the token and calls management routes with `Authorization: Bearer aur_…`.

### B — Login JWT (short-lived)

```http
POST /api/v1/auth/login
Content-Type: application/json

{"email":"you@example.com","password":"…"}
```

Use returned `token` as Bearer for up to 7 days. Also returns `user.siteKey` for the public frontend.

### Create / list / revoke tokens

```http
Authorization: Bearer <jwt-or-api-token>

GET    /api/v1/admin/tokens
POST   /api/v1/admin/tokens
{"name":"site-builder","expiresInDays":90}

DELETE /api/v1/admin/tokens/:id
```

`POST` response includes raw `token` **only once**.

---

## Provision in one call (recommended for agents)

Idempotent upsert of types, fields, and entries:

```http
POST /api/v1/admin/provision
Authorization: Bearer aur_…
Content-Type: application/json
```

```json
{
  "contentTypes": [
    {
      "apiId": "page",
      "name": "Page",
      "description": "Marketing pages",
      "fields": [
        { "apiId": "title", "name": "Title", "type": "text", "required": true, "sortOrder": 0 },
        { "apiId": "body", "name": "Body", "type": "richtext", "required": true, "sortOrder": 1 }
      ],
      "entries": [
        {
          "slug": "home",
          "status": "published",
          "fields": {
            "title": "Welcome",
            "body": "Built by a site-building agent."
          }
        }
      ]
    }
  ]
}
```

Behavior:

- Creates the content type if missing; updates name/description if present.
- Creates missing fields; updates existing field metadata.
- Upserts entries by `(slug, locale)`; sets draft/published accordingly.
- Scoped to the authenticated account only.

Then point the frontend at that account’s **`siteKey`** for public reads.

### curl example (demo token)

```bash
API=http://localhost:4000
TOKEN=aur_live_demo_write_token_change_me

curl -s -X POST "$API/api/v1/admin/provision" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "contentTypes": [{
      "apiId": "landing_block",
      "name": "Landing block",
      "fields": [
        {"apiId":"headline","name":"Headline","type":"text","required":true}
      ],
      "entries": [{
        "slug":"hero",
        "status":"published",
        "fields":{"headline":"Hello from provision"}
      }]
    }]
  }'
```

Verify publicly:

```bash
curl -s "$API/api/v1/content-types/landing_block/entries/hero" \
  -H "x-site-key: demo-site-key"
```

---

## Granular management endpoints

All require `Authorization: Bearer <jwt|aur_…>` and are **tenant-scoped**.

### Website (admin)

| Method | Path | Body |
|--------|------|------|
| GET | `/api/v1/admin/website` | — |
| PATCH | `/api/v1/admin/website` | `{ name?, description?, allowedOrigins? }` |

Returns website details (`id`, `name`, `description`, `siteKey`, `allowedOrigins`, timestamps). `allowedOrigins` is the list of browser origins allowed for CORS for this website’s frontends (merged with global `CORS_ORIGINS` at runtime). PATCH with a JWT also returns a refreshed `{ token, user, websites }` so `websiteName` stays in sync. `siteKey` is not writable.

### Content types

| Method | Path | Body |
|--------|------|------|
| GET | `/api/v1/admin/content-types` | — |
| GET | `/api/v1/admin/content-types/:apiId` | — |
| POST | `/api/v1/admin/content-types` | `{ apiId, name, description? }` |
| PATCH | `/api/v1/admin/content-types/:apiId` | `{ name?, description? }` |
| DELETE | `/api/v1/admin/content-types/:apiId` | — |

### Fields

| Method | Path | Body |
|--------|------|------|
| POST | `/api/v1/admin/content-types/:apiId/fields` | `{ apiId, name, type, required?, sortOrder? }` |
| PATCH | `.../fields/:fieldApiId` | `{ name?, type?, required?, sortOrder? }` |
| DELETE | `.../fields/:fieldApiId` | — |

Field `type`: `text` \| `textarea` \| `richtext` \| `boolean` \| `datetime` \| `number` \| `slug` \| `media`

### Media upload

| Method | Path | Body |
|--------|------|------|
| POST | `/api/v1/admin/media` | `multipart/form-data` with field `file` (jpeg/png/webp/gif, max 5MB) |

Response: `{ url, filename, mimeType, size }`. Store `url` in a `media` entry field. Files are public at `GET /uploads/{websiteId}/{filename}`.

### Entries

| Method | Path | Notes |
|--------|------|------|
| GET | `.../entries` | Query: `limit`, `offset`, `slug`, `status` |
| GET | `.../entries/by-id/:entryId` | By id |
| POST | `.../entries` | `{ slug, locale?, status?, fields? }` — default status `draft` |
| PATCH | `.../entries/:entryId` | Partial update |
| DELETE | `.../entries/:entryId` | — |
| POST | `.../entries/:entryId/publish` | Public visibility |
| POST | `.../entries/:entryId/unpublish` | Back to draft |

### Versions & AI

| Path | Purpose |
|------|---------|
| `.../entries/:entryId/versions` | List / create checkpoints |
| `.../versions/:versionId/restore` | Restore |
| `/api/v1/admin/ai/*` | Per-account AI operator |

---

## Agent playbook: configure CMS while building a frontend

1. **Register or pick an account** (or use demo credentials locally).
2. **Obtain management auth** — API token preferred (`aur_…`).
3. **Save `user.siteKey`** for the frontend env (`NEXT_PUBLIC_CMS_SITE_KEY`).
4. **`POST /api/v1/admin/provision`** with the schemas and seed content your frontend needs.
5. **Build the frontend** against the [Public API](./public-api.md) using `x-site-key`.
6. Optionally refine entries via granular PATCH/publish calls.

Never embed the management API token in a public browser bundle. Use it only in trusted agent/CI/server contexts.

---

## Security rules

1. Management tokens are as powerful as the account password for CMS data — store like secrets.
2. Public site key only reads **published** content.
3. New registrations start empty; provision creates the model.
4. Isolation is absolute: token of user A cannot mutate user B.
5. Revoke tokens with `DELETE /api/v1/admin/tokens/:id` when an agent finishes or leaks.
