# Overview

## What Aurora is

Aurora is a **headless CMS**:

- Editors manage content in an **admin studio** (browser UI).
- Frontends (websites, apps) load content over a **HTTP JSON API**.
- There is **no** HTML page builder and **no** theme baked into the API. Presentation is 100% your frontend’s job.

## What Aurora is not

- Not WordPress / not a theme engine
- Not a file-based CMS (content lives in PostgreSQL)
- Multi-website tenancy with membership roles (`editor` / `builder` / `admin`)
- Public reads via website `siteKey`; studio writes via JWT or API token
- Not a media CDN (local disk uploads under `/uploads`; no transforms/S3 yet)

## Core concepts (one paragraph)

A **website** owns a private set of **content types** (schemas). Each content type has **fields** and many **entries**. Entries have a URL-safe **slug**, a **status** (`draft` | `published`), and a flat **`fields`** object. Users access websites through **memberships** with roles. Frontends authenticate publicly with that website’s **`siteKey`** and may only read **published** entries.

## System parts

```
┌─────────────────┐     JWT Bearer      ┌──────────────────┐
│  Admin studio   │ ──────────────────► │                  │
│  :3001          │                     │   CMS API        │
└─────────────────┘                     │   :4000          │
                                        │                  │
┌─────────────────┐   x-site-key        │  PostgreSQL      │
│  Your frontend  │ ──────────────────► │                  │
│  (or demo :3000)│                     └──────────────────┘
└─────────────────┘
```

| Part | Role for a frontend agent |
|------|---------------------------|
| API | Source of truth for published content |
| Admin | Humans create/edit/publish; AI-first studio with a persistent assistant dock (role-scoped tools). Schema changes include a copy-paste **frontend agent brief**. `/ai` is provider settings only. |
| Demo `apps/web` | Reference implementation — copy patterns, do not treat as required |

## Schema-driven model

Content shapes are **data**, not hard-coded TypeScript models in the API:

1. Call `GET /api/v1/content-types` → learn available types and their fields.
2. Call `GET /api/v1/content-types/{apiId}/entries` → list published entries.
3. Call `GET /api/v1/content-types/{apiId}/entries/{slug}` → one entry.

A **new registered account starts empty** (no types). The **seeded demo account** ships with a full marketing-site model (`page`, `post`, `nav_item`, …). See [demo-content-map.md](./demo-content-map.md).

## Success criteria for a frontend agent

You have succeeded when your site:

1. Sends `x-site-key` on every content request.
2. Renders only published content (automatic if you use the public API).
3. Reads values from `entry.fields.<fieldApiId>`.
4. Handles missing types/entries gracefully (empty account or unpublished content → empty UI, not crashes).
5. Prefers `?sort=sortOrder` on lists (nav, FAQ, docs); falls back to client sort only if needed.
