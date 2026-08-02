# Aurora CMS documentation

Canonical instructions for humans **and** AI agents building frontends against Aurora.

These files are seeded into the CMS as content type **`doc`** and published on the product site at **`/docs`**.

## Read order

| Doc | Topic |
|-----|--------|
| [overview.md](./overview.md) | What Aurora is |
| [multi-tenancy.md](./multi-tenancy.md) | Accounts, `siteKey`, isolation |
| [content-model.md](./content-model.md) | Types, fields, entries, publishing |
| [response-shapes.md](./response-shapes.md) | JSON shapes |
| [public-api.md](./public-api.md) | Public HTTP API (read + form submit) |
| [forms.md](./forms.md) | Form builder, submit API, embeds |
| [management-api.md](./management-api.md) | Write API for agents (tokens, provision, CRUD) |
| [mcp.md](./mcp.md) | MCP server for Cursor/Claude (stdio, website-scoped tokens) |
| [demo-content-map.md](./demo-content-map.md) | Seeded product-site content map |
| [frontend-playbook.md](./frontend-playbook.md) | Build a frontend step by step |
| [typed-client.md](./typed-client.md) | `@cms/shared` client |
| [errors-and-gotchas.md](./errors-and-gotchas.md) | Common failures |
| [admin-api.md](./admin-api.md) | Optional write API |
| [deploy-raspberry-pi.md](./deploy-raspberry-pi.md) | Pi + Docker + Cloudflare + GitHub Actions |

## Absolute rules

1. Public frontends use **`x-site-key`**, never management tokens.
2. Public API returns **published** entries only.
3. Values live in **`entry.fields.<fieldApiId>`**.
4. Prefer `?sort=sortOrder&order=asc` on list endpoints when a `sortOrder` field exists (nav, FAQ, docs, services).
5. Each login is a separate CMS; wrong site key → wrong/empty content.
6. Site-building agents configure types/content via the **[Management API](./management-api.md)** (`Bearer aur_…` or JWT) — never with the site key.

## Local endpoints

| Service | URL |
|---------|-----|
| API | http://localhost:4000 |
| Product site | http://localhost:3000 |
| Admin | http://localhost:3001 |
| Docs on site | http://localhost:3000/docs |

## Demo tenant

| Item | Value |
|------|-------|
| Email | `demo@aurora.local` |
| Password | `demo-demo-demo` |
| Site key (public read) | `demo-site-key` |
| Management API token | `aur_live_demo_write_token_change_me` |
