# Management API (write from outside)

Use this when a **site-building agent** or automation must create and edit **content types** and **content** for an Aurora account.

For Cursor / Claude Desktop, prefer the **[MCP server](./mcp.md)** (`apps/mcp`) which wraps this API over stdio with the same website-scoped `aur_…` token.

Public frontends use only `x-site-key` (read). Management uses a **Bearer token** scoped to one website.

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
| PATCH | `/api/v1/admin/website` | `{ name?, description?, allowedOrigins?, locales?, defaultLocale? }` |

Returns website details (`id`, `name`, `description`, `siteKey`, `allowedOrigins`, `locales`, `defaultLocale`, timestamps). `locales` are BCP-47 language-REGION tags. Removing a locale that still has entries returns `409 LOCALE_IN_USE`. `allowedOrigins` is the list of browser origins allowed for CORS for this website’s frontends (merged with global `CORS_ORIGINS` at runtime). PATCH with a JWT also returns a refreshed `{ token, user, websites }` so `websiteName` stays in sync. `siteKey` is not writable.

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
| POST | `/api/v1/admin/media` | `multipart/form-data` with field `file` (jpeg/png/webp/gif, max 25MB) |
| GET | `/api/v1/admin/media/status` | — (active provider; ImageKit secrets masked) |
| GET | `/api/v1/admin/media/library` | ImageKit library (`skip`, `limit`, `q`) — requires ImageKit credentials |
| PUT | `/api/v1/admin/media/config` | Admin: `{ provider?, publicKey?, privateKey?, clearPrivateKey?, urlEndpoint?, folder? }` |

Upload response: `{ url, filename, mimeType, size, provider, fileId? }`. Store `url` in a `media` entry field.

- **local** (default): files at `GET /uploads/{websiteId}/{filename}`
- **imagekit**: when configured in Studio → Settings → Media storage, uploads go to ImageKit CDN (folder `/{optionalFolder}/{websiteId}/`) and `url` is the ImageKit delivery URL. Oversized images are auto-downscaled on upload (`w/h ≤ 2560`, quality 80) via ImageKit pre-transformation.

### Entries

| Method | Path | Notes |
|--------|------|------|
| GET | `.../entries` | Query: `limit`, `offset`, `slug`, `status`, `locale`, `q`, `sort`, `order`, `field`, `in`. Field filter: `field=<fieldApiId>&in=v1,v2` (max 50 values). Supported field types: `text`, `textarea`, `slug`, `username`, `relation`, `relations`, `number`, `boolean`, `datetime`. Unsupported (`richtext`, `media`, `password`), unknown field, or empty `in` → `400`. `total` is filtered when `field`/`in` are set. |
| GET | `.../entries/by-id/:entryId` | By id |
| GET | `.../entries/:entryId/fields/:fieldApiId` | One string field in full. Response: `{ entryId, fieldApiId, value, length, sha256, byteLength, truncated: false, updatedAt }`. Field must exist on the content type. Non-string current value → `400`. Secret fields (`password` today, via `isSecretField`) → `400`. Never returns a sliced value. Hash spec: normalize `\\r\\n` and lone `\\r` → `\\n`; no trim; sha256 of UTF-8 bytes (lowercase hex); `length` is JS `string.length` of the stored value. |
| POST | `.../entries` | `{ slug, locale?, status?, fields? }` — default status `draft`; locale defaults to website `defaultLocale` |
| POST | `.../entries/:entryId/translations` | `{ locale }` — copy fields as draft translation |
| POST | `.../sync-locales` | `{ dryRun? }` — for `all_locales` types: create missing locale stubs |
| PATCH | `.../entries/:entryId` | Partial update. Body: `{ slug?, locale?, status?, fields?, field_edits?, json_edits?, expected_field_hashes? }`. `fields` merges by field apiId (unknown keys silently skipped). `field_edits` applies atomic find/replace on string fields: `{ "<apiId>": [{ old_string, new_string, replace_all? }] }`. `json_edits` structurally patches a string field whose current value is JSON (any content type): `{ "<apiId>": [{ path, match, op, value? }] }`. `path` is a JSON Pointer that **must** resolve to an array; `match` selects exactly one object. Ops: `insert_after` \| `insert_before` \| `replace` (shallow merge) \| `replace_object` \| `remove`. Invalid JSON / path not an array → `400`. 0 matches → `409` `not_found`; >1 → `409` `ambiguous`. Writes `JSON.stringify(doc, null, 2)`. Cannot send the same field apiId in more than one of `fields` / `field_edits` / `json_edits` → `400 VALIDATION_FAILED`. Unknown field apiId in `field_edits` / `json_edits` → `400` (fail-loud; unlike `fields`). `password` and `slug` field types cannot be patched. Non-string current value → `400`. Anchor not found or ambiguous (without `replace_all`) → `409 CONFLICT` with `issues` path `["field_edits", "<apiId>", <index>]`. Optional `expected_field_hashes: { "<apiId>": "<sha256>" }` is compared to the current stored value after newline-normalization; mismatch → `409 STALE_HASH` and nothing is written. Hash-less `fields` / `field_edits` behaviour is unchanged. Before match, `\\r\\n` and lone `\\r` are normalized to `\\n` in stored value and edit strings. Response is `FlatEntry` plus optional `fieldEditSummary` / `jsonEditSummary`: `{ applied, fields: { [apiId]: { length, sha256 } } }`. `field_edits` / `json_edits` alone do not change `status`/`publishedAt`. All meta, `fields`, `field_edits`, and `json_edits` changes run in one DB transaction with row lock on the entry. |
| DELETE | `.../entries/:entryId` | — |
| POST | `.../entries/:entryId/publish` | Public visibility |
| POST | `.../entries/:entryId/unpublish` | Back to draft |
| POST | `.../entries/:entryId/verify-password` | `{ password, fieldApiId? }` — check plaintext against a hashed `password` field (draft or published). Success `{ ok: true, fieldApiId }`. Wrong password → `401` `INVALID_CREDENTIALS`. Missing field → `404` `PASSWORD_FIELD_NOT_FOUND`. Unset → `400` `PASSWORD_NOT_SET`. Never returns the hash. |
| POST | `.../verify-credentials` | `{ slug, username, password, locale?, usernameFieldApiId?, passwordFieldApiId? }` — look up entry by slug (+ locale, default website `defaultLocale`) and verify username + password fields. Success includes `entryId`. Wrong username/password/unknown slug → `401` `INVALID_CREDENTIALS` (no distinction). |

Studio-AI `get_entry_field` uses the same read as HTTP but refuses values longer than 200_000 characters (`FIELD_TOO_LARGE`) and never returns a slice. MCP `get_entry_field` always returns the full value. Studio `get_entry` still has a 6_000-character tool-result budget: overflow sets `dataTruncated: true` and replaces large strings with `{ apiId, length, sha256, omitted: true }` instead of slicing JSON.

Password verify endpoints are **management-only** (not available with `x-site-key`). Use them from a trusted backend (e.g. TraceAI `POST /v1/ui/login/verify`) so frontends never see hashes or management tokens.

### Versions, audit & AI

Entry and content-type mutations create immutable JSON snapshots (`source`: `auto` | `manual` | `ai` | `restore`). Restore never deletes history (pre-restore checkpoint first). Field-level compare via `.../versions/diff?from=&to=`. Append-only audit: `GET /api/v1/admin/audit-events`.

| Path | Purpose |
|------|---------|
| `.../entries/:entryId/versions` | List (paginated) / create checkpoints |
| `.../entries/:entryId/versions/diff?from=&to=` | Field-level entry diff |
| `.../entries/:entryId/versions/:versionId/restore` | Restore entry |
| `.../content-types/:apiId/versions` | List / create schema checkpoints |
| `.../content-types/:apiId/versions/diff?from=&to=` | Schema field-level diff |
| `.../content-types/:apiId/versions/:versionId/restore` | Restore schema (blocks unsafe type changes with values) |
| `/api/v1/admin/audit-events` | List audit events (`resourceType`, `resourceId`, pagination) |
| `/api/v1/admin/ai/*` | Per-account AI operator |

### Scheduled tasks (Taken)

Outlook-like **scheduled AI agent runs** for a website. Studio: **Settings → Taken** (`/tasks`). Runs use the full agent tool loop (`mode: general`), not entry `mode: "macro"`.

| Method | Path | Roles | Notes |
|--------|------|-------|-------|
| GET | `/api/v1/admin/scheduled-tasks` | builder+ | List tasks (+ up to 5 recent runs each) |
| GET | `/api/v1/admin/scheduled-tasks/:id` | builder+ | Detail |
| POST | `/api/v1/admin/scheduled-tasks` | admin | Create; computes initial `nextRunAt` |
| PATCH | `/api/v1/admin/scheduled-tasks/:id` | admin | Update schedule / prompt / enabled |
| DELETE | `/api/v1/admin/scheduled-tasks/:id` | admin | Delete |
| POST | `/api/v1/admin/scheduled-tasks/:id/run-now` | admin | Execute immediately via same runner |

**Create body (essentials):**

| Field | Notes |
|-------|--------|
| `name` | Display label |
| `prompt` and/or `macroId` | If `macroId` set, prompt is copied from `ai.macros` when omitted |
| `frequency` | `once` \| `daily` \| `weekly` \| `monthly` |
| `timeOfDay` | Local `HH:mm` in `timeZone` |
| `timeZone` | IANA, default `Europe/Amsterdam` |
| `byWeekday` | Required for weekly: `0`=Sunday … `6`=Saturday |
| `byMonthDay` | Required for monthly: `1`–`31` (clamped to month length) |
| `startAt` / `endAt` | ISO datetimes; `endAt` optional — no further fires after it |
| `enabled` | Default `true` |
| `allowPublish` | Default `false`. When `true` (admin opt-in), the agent may publish/unpublish during the run |
| `maxTokens` | Optional soft cap on total LLM tokens for one run (`null`/omit = no extra cap) |
| `maxToolCalls` | Optional soft cap on tool invocations for one run (`null`/omit = agent default step limit) |

**Runtime**

- In-process API poller (~45s) after listen. Disable with `CMS_SCHEDULED_TASKS=0`.
- Soft timeout: `CMS_SCHEDULED_TASK_TIMEOUT_MS` (default `180000`).
- Max **one concurrent run per website**; optimistic claim on `nextRunAt`.
- AI usage metered with source `scheduled_task`.
- **Draft-only by default:** `publish_entry` / `unpublish_entry` are omitted and blocked unless `allowPublish` is true; create/meta still forced to draft when publish is not allowed.
- Optional per-task caps (`maxTokens` / `maxToolCalls`) stop the agent loop gracefully; run rows store `promptTokens`, `completionTokens`, `totalTokens`, `toolCallCount`, `uniqueToolCount`, and `stoppedReason` (`completed` \| `max_tokens` \| `max_tool_calls` \| `error` \| `timeout`).
- After a run: `once` or exhausted schedule → `enabled: false`, `nextRunAt: null`; otherwise `nextRunAt` advances.
- Inspect failures via `lastStatus` / `lastError` on the task and `ScheduledTaskRun` rows (`summary`, `reply`, usage fields).

`CmsClient`: `listScheduledTasks`, `getScheduledTask`, `createScheduledTask`, `updateScheduledTask`, `deleteScheduledTask`, `runScheduledTaskNow`.

---

## Content packages (export / import)

Admin-only ZIP packages for moving content between websites or Aurora instances.

### Package layout (`formatVersion: 1`)

```
aurora-package.zip
  manifest.json      # formatVersion, exportedAt, sourceSiteKey, selections
  content.json       # { contentTypes: [...] } — same shape as provision
  forms.json         # { forms: [...] } — form definitions + fields (no submissions)
  media-map.json     # [{ fromUrl, path }] mapping original URLs → media/…
  media/…            # binary image files referenced by entries
```

### Export

```http
POST /api/v1/admin/packages/export
Authorization: Bearer <jwt|aur_…>
Content-Type: application/json
```

```json
{
  "contentTypeApiIds": ["doc", "page"],
  "entrySlugsByType": {
    "doc": ["readme", "overview", "public-api"]
  },
  "formApiIds": ["contact"],
  "includeMedia": true
}
```

`entrySlugsByType` is optional per content type: if omitted for a type, **all** entries are exported; if present (even as `[]`), only those slugs are included. The type schema is always exported for each selected `contentTypeApiId`.

Response: `application/zip` attachment. Requires **admin** role on the active website.

### Import

```http
POST /api/v1/admin/packages/import
Authorization: Bearer <jwt|aur_…>
Content-Type: multipart/form-data
```

Fields:

| Field | Value |
|-------|--------|
| `file` | The package ZIP (max 50MB) |
| `mode` | `overwrite` (update existing) or `skip` (only create missing) |

Media files are rematerialized under the target website’s `/uploads/{websiteId}/` and entry field URLs are rewritten. Submissions, API tokens, members, and website settings are not included.

Studio: **Packages** in the admin nav (admin role).

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
