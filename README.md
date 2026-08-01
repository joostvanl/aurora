# Aurora CMS

Headless CMS starter: schema-driven content API, admin studio, and a demo website.

## Stack

- **API** — Fastify + Prisma + PostgreSQL (`apps/api`)
- **Admin** — Next.js App Router (`apps/admin`, port 3001)
- **Demo site** — Next.js App Router (`apps/web`, port 3000)
- **Shared** — Zod schemas + typed API client (`packages/shared`)

## Quick start

Prerequisites: Node 20+, Docker Desktop running, and [pnpm](https://pnpm.io) 9 (`corepack enable` or `npx pnpm` if pnpm is not installed globally).

```bash
# 1. Postgres
docker compose up -d

# 2. Install (builds workspace packages as needed)
pnpm install
# or: npx pnpm@9.15.0 install

# 3. Env (repo root `.env` — used by the API)
cp .env.example .env

# 4. Database
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# 5. Dev (API :4000, web :3000, admin :3001)
pnpm dev
```

Open:

- Product site + docs: http://localhost:3000
- Documentation: http://localhost:3000/docs
- Admin: http://localhost:3001
- API health: http://localhost:4000/health

The website at `:3000` is the **Aurora product site** (not a dummy brochure). Marketing content comes from the CMS; the full technical instruction set lives in `docs/` and is served at `/docs`.

### Auth (multi-tenant)

- **Admin** requires login (JWT). Each account owns its own content types, entries, versions, and AI settings.
- **Register** creates an empty CMS (no types/entries).
- **Seed** creates a demo account:

  - Email: `demo@aurora.local`
  - Password: `demo-demo-demo`
  - Site key: `demo-site-key`

- **Public API** requires header `x-site-key` (the account’s site key). The product site uses `NEXT_PUBLIC_CMS_SITE_KEY`.
- **Management API** (create/edit types & content) requires `Authorization: Bearer <JWT|aur_…>`. See `/docs/management-api`. Local seed includes `aur_live_demo_write_token_change_me` for agents.

Set `CMS_JWT_SECRET` in `.env` (required for login tokens).

## Content model

Content types and fields live in the database (schema-driven), scoped per user. Seed creates for the demo account:

| Type | Purpose |
|------|---------|
| `site_settings` | Global name, CTA, contact, social, footer (`slug: default`) |
| `nav_item` | Primary navigation labels + hrefs |
| `page` | Static pages (home, about, contact, …) |
| `author` | Blog authors |
| `post` | Journal posts (category, authorSlug, reading time) |
| `service` | Service offerings |
| `project` | Case studies / work |
| `team_member` | Team profiles |
| `testimonial` | Customer quotes |
| `faq` | FAQ items by category |

Demo site routes: `/`, `/about`, `/services`, `/work`, `/team`, `/blog`, `/faq`, `/contact` (+ detail pages).

## AI (OpenAI-compatible)

Configure via **Admin → AI** (saved per login):

```bash
# Optional: only used by `pnpm db:seed` to prefill the demo account
CMS_AI_BASE_URL="https://api.openai.com/v1"
CMS_AI_API_KEY="sk-..."
CMS_AI_MODEL="gpt-4o-mini"
```

Each account stores its own provider settings. A new registration starts with AI disabled until configured.

When configured, the AI operator can:

- Create/update content types and fields
- Create entries and publish/unpublish
- Write or optimize copy using **find/replace patches** (`str_replace`) instead of rewriting whole fields
- Entry editor applies tool results into the form fields immediately
- **Forms:** create/update/delete forms and fields; inspect the submission inbox (`form_submission_stats`, list/get submissions); summarize insights; mark read or delete submissions

**Versions:** before AI field edits, Aurora stores an entry snapshot (`source: ai`). Restore any version from the entry editor, or save a manual checkpoint. Restoring also snapshots the current state first.

Public API returns only **published** entries as flat JSON (with `x-site-key`):

```http
GET /api/v1/content-types/post/entries
GET /api/v1/content-types/page/entries/home
GET /api/v1/content-types/service/entries
```

## Extensibility hooks

Prepared for later features:

- **RBAC / roles** — JWT auth is in place; add roles/permissions next
- **Plugins** — `apps/api/src/plugins/` + event bus in `apps/api/src/core/hooks.ts` (`onEntryPublish`, …)
- **Locales** — `Entry.locale` defaults to `en`

Uploaded images for `media` fields are stored under `uploads/` (gitignored) and served publicly at `GET /uploads/...` on the API.

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Run all apps via Turborepo |
| `pnpm build` | Build shared + apps |
| `pnpm db:migrate` | Prisma migrate (dev) |
| `pnpm db:seed` | Seed demo user + content types + entries |
| `pnpm db:studio` | Prisma Studio |
