# Multi-tenancy and authentication

## Mental model

A **website** is the tenant:

- Own content types, entries, forms, settings, AI config, scheduled tasks, API tokens
- Own public **`siteKey`**
- Multiple **users** via **memberships**, each with a role

### Roles

| Role | Access |
|------|--------|
| **editor** | Entries, publish/versions, form submission inbox, AI dock chat (if configured) |
| **builder** | Everything editor can do, plus content types, form schemas, API tokens, provision; **read** scheduled tasks |
| **admin** | Everything, including members, website properties, AI provider config, and scheduled task CRUD / run-now |

Any logged-in user can also **create additional websites** (they become admin of the new site).

## Website properties vs site content

Keep **tenant / studio** data on the Prisma `Website` row. Keep **public brand chrome** in CMS content (`site_settings`).

| Property | Where | Editable in Aurora | Notes |
|----------|--------|--------------------|-------|
| **Name** | `Website.name` | Yes (admins) | Studio label: sidebar, switcher, JWT `websiteName` |
| **Description** | `Website.description` | Yes (admins) | Optional internal note; not public |
| **Site key** | `Website.siteKey` | Read-only (copy) | Public frontend key (`x-site-key`); immutable |
| **Allowed origins** | `Website.allowedOrigins` | Yes (admins) | Browser CORS origins for this website’s frontends (e.g. `http://localhost:5180`). Merged at runtime with global `CORS_ORIGINS` (studio defaults). |
| **Id / timestamps** | `Website` | Read-only | Diagnostics |
| Tagline, CTA, contact, social, footer | `site_settings` entry | Via Entries | Public site chrome |

**Locales:** website `locales` + `defaultLocale` (BCP-47 language-REGION). Configure in Admin → Website. Archived flag / billing plan still out of scope.

Studio UI: **Website** (`/website`). API: `GET|PATCH /api/v1/admin/website` (admin role). Patch body may include `allowedOrigins: string[]`.

## Two credentials — never mix them up

| Credential | Header | Who uses it | Purpose |
|------------|--------|-------------|---------|
| **Site key** | `x-site-key: <siteKey>` | Public frontends | Read published content for that website |
| **API token** | `Authorization: Bearer aur_…` | Agents / automation | Website-scoped write access (treated as admin) |
| **JWT access token** | `Authorization: Bearer <jwt>` | Admin studio / short scripts | Scoped to a selected website + membership role |

**Frontend builders (read):** use only `x-site-key`.  
**Site-building agents (write):** use API token or JWT — see [management-api.md](./management-api.md).

| Call | Needs |
|------|--------|
| `GET /health` | nothing |
| `POST /api/v1/auth/register` | nothing |
| `POST /api/v1/auth/login` | nothing |
| `POST /api/v1/auth/select-website` | Bearer (user JWT) |
| `POST /api/v1/auth/websites` | Bearer (user JWT) |
| `GET /api/v1/content-types…` (public) | `x-site-key` |
| `GET|POST|PATCH|DELETE /api/v1/admin/…` | Bearer JWT **or** `aur_…` API token |
| `POST /api/v1/admin/provision` | Bearer builder+ |
| `GET /api/v1/auth/me` | Bearer |

## Auth flow

1. `POST /auth/register` — creates user + first website (caller is **admin**) + JWT
2. `POST /auth/login` — returns JWT + `websites[]` + `needsWebsiteSelection`
3. If the user has multiple websites (or none selected), call `POST /auth/select-website` with `{ websiteId }` to get a website-scoped JWT (`websiteId`, `role`, `siteKey`)
4. Studio and admin APIs require a website-scoped JWT (or an `aur_…` token)

## How to obtain a site key

### Option A — demo seed (local)

After `pnpm db:seed`:

```
siteKey = demo-site-key
```

Env for frontends:

```bash
NEXT_PUBLIC_CMS_API_URL=http://localhost:4000
NEXT_PUBLIC_CMS_SITE_KEY=demo-site-key
```

### Option B — from login / select-website response

After selecting a website, `user.siteKey` is the public key for that website.

```json
{
  "token": "<jwt>",
  "user": {
    "id": "...",
    "email": "you@example.com",
    "websiteId": "...",
    "websiteName": "My site",
    "role": "admin",
    "siteKey": "abc123...",
    "createdAt": "..."
  },
  "websites": [...],
  "needsWebsiteSelection": false
}
```

Put `user.siteKey` in the frontend env as the public key. **Do not put the JWT in a public frontend.**

### Option C — Admin UI

After sign-in, the sidebar shows `siteKey: …` for the active website.

## Register behavior

Register creates a **new website** and makes the user its **admin**. Logged-in users can create more websites from **Websites** in the studio. Website **admins** invite members and assign roles.

## Isolation rules

- Content, forms, settings, tokens, and AI config are keyed by **`websiteId`**
- Public reads resolve `x-site-key` → **Website**
- Membership is required for studio access; role checks enforce editor / builder / admin
