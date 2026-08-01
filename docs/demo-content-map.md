# Site content map (seeded Aurora product)

This documents the **seeded demo account** content used by the Aurora product website (`apps/web`). Other accounts may differ — always discover via `GET /api/v1/content-types`.

Account: `demo@aurora.local` · site key: `demo-site-key`

## Navigation (`nav_item`)

Sort client-side by `fields.sortOrder`. Header and footer Explore both use this list.

| slug | Typical href | Purpose |
|------|--------------|---------|
| home | `/` | Product home |
| docs | `/docs` | Full documentation (`doc` entries) |
| features | `/services` | Capabilities (`service`) |
| use-cases | `/work` | Use cases (`project`) |
| guides | `/blog` | Guides / journal (`post`) |
| blogs | `/blogs` | Blog articles (`blog`) |
| pricing | `/pricing` | Variable pricing |
| faq | `/faq` | FAQ |
| about | `/about` | About |
| contact | `/contact` | Contact |

## Site settings (`site_settings` / slug `default`)

Global brand, CTA, contact, social, footer. One entry: `default`.

This is **public chrome**, not the Aurora tenant name. Rename the website in studio under **Website** (`Website.name`); keep brand copy here.

## Pages (`page`)

All marketing landings are CMS-driven via `page` entries (hero + optional body). Collection lists stay on their own types.

| slug | Route on this site |
|------|--------------------|
| `home` | `/` | hero + body + CTA fields; section titles from sibling pages |
| `about` | `/about` | |
| `contact` | `/contact` | embeds form `contact` via `formApiId` |
| `pricing` | `/pricing` | Variable pricing copy |
| `services` | `/services` | Features landing |
| `work` | `/work` | Use cases landing |
| `blog` | `/blog` | Guides landing |
| `blogs` | `/blogs` | Blogs landing |
| `faq` | `/faq` | FAQ landing |
| `team` | `/team` | Team landing |
| `testimonials` | (home section only) | Title/lead for testimonials band |

Optional page fields: `formApiId`, `ctaTitle`, `ctaLead`, `secondaryCtaLabel`, `secondaryCtaHref`.

New static pages: publish a `page` entry and use `/[slug]` (unless the slug is reserved for a dedicated route).

## Docs (`doc`) → `/docs`, `/docs/[slug]`

Product documentation is CMS-driven (Markdown in field `body`). Sort by `fields.sortOrder`. Index page uses slug `readme`.

Source of truth for seeding: repo `docs/*.md` via `pnpm --filter @cms/api db:seed-docs` (also part of full `db:seed`).

## Forms (not content types)

| apiId | Purpose |
|-------|---------|
| `contact` | Contact form (name, email, message + honeypot) |

Public: `GET/POST /api/v1/forms/contact`. Inbox: admin → Forms → contact → Submissions. See [forms.md](./forms.md).

## Capabilities (`service`) → `/services`, `/services/[slug]`

Product capabilities (API, studio, multi-tenant, AI, …).

## Use cases (`project`) → `/work`, `/work/[slug]`

Concrete scenarios (marketing site, docs portal, multi-brand, …).

## Guides (`post`) → `/blog`, `/blog/[slug]`

Editorial guides. Related author via `fields.authorSlug` → `author` entries.

## Blogs (`blog`) → `/blogs`, `/blogs/[slug]`

Blog articles (title, slug, body HTML).
