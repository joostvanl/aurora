# Aurora MCP server

Model Context Protocol server so coding agents (Cursor, Claude Desktop, MCP Inspector) can manage Aurora websites through the Management API.

**Preferred for Cursor Cloud and most IDE setups:** hosted Streamable HTTP on the SaaS API. **Stdio** remains for maintainers and local checkouts. The package lives at `apps/mcp` (`@cms/mcp`); the HTTP transport is mounted on the API.

Prefer a **user personal access token** (`aur_u_…`) so one Cursor config works across all websites you belong to. Website-scoped `aur_…` tokens remain supported for automation.

## Security model

| Rule | Detail |
|------|--------|
| Hosted transport | Streamable HTTP at `/mcp` on the API host. Stateless (no sticky MCP session). Bearer on every call. |
| Local transport | **stdio** (`node …/apps/mcp/dist/index.js`). The host launches the process; nothing extra listens on a port. |
| Preferred auth | `aur_u_…` PAT. Rights = your **membership role** on the active website. Hosted: `Authorization: Bearer`. Stdio: `CMS_USER_TOKEN`. |
| Legacy auth | `aur_…` bound to **one** website with admin privileges. |
| Website switch | With a user PAT: `list_websites` → `select_website` (no env edits). Last selection is stored on the user so the next HTTP request auto-selects it. |
| Session JWT | After `select_website`, MCP uses the returned JWT for management calls internally. Do **not** send a Studio JWT as the MCP Bearer. |
| Default site | Stdio: optional `CMS_WEBSITE_ID` pins on start (wins over last selection). Hosted: one membership, or last selected website. |
| Site key | Optional `CMS_SITE_KEY` (stdio) for public-read tools; after select, MCP can use the API `siteKey` when env is unset. |
| No login tool | Do not put passwords in the agent chat; create tokens in Studio. |

Cross-tenant isolation is enforced by the API. MCP only forwards Bearer credentials.

## Hosted HTTP (preferred)

Public URL:

`https://aurora-api.joostvanleeuwaarden.com/mcp`

Copy [`apps/mcp/mcp.json.example`](../apps/mcp/mcp.json.example) into your Cursor MCP config (`~/.cursor/mcp.json`) and fill the token. **Never commit real tokens.**

```json
{
  "mcpServers": {
    "aurora": {
      "url": "https://aurora-api.joostvanleeuwaarden.com/mcp",
      "headers": {
        "Authorization": "Bearer aur_u_YOUR_PERSONAL_TOKEN"
      }
    }
  }
}
```

No `command`/`args`, no `CMS_API_URL` in the client env. After changing MCP config in Cursor, refresh the MCP server list (or reload the window).

`POST /mcp` without a valid `aur_u_…` / `aur_…` Bearer returns **401**. JWT is rejected.

## Local stdio (maintainer)

- Node 20+
- Built package: `pnpm --filter @cms/mcp build`
- API reachable at `CMS_API_URL`
- Personal access token from Studio → **Settings** → **Personal access tokens**

| Variable | Required | Meaning |
|----------|----------|---------|
| `CMS_API_URL` | yes | e.g. `http://localhost:4000` or production API URL |
| `CMS_USER_TOKEN` | preferred | `aur_u_…` personal access token |
| `CMS_MANAGEMENT_TOKEN` | legacy | `aur_…` website token (still supported) |
| `CMS_WEBSITE_ID` | optional | Default website to auto-select on start (overrides last selection) |
| `CMS_SITE_KEY` | optional | Enables / pins public tools to this site key |

```json
{
  "mcpServers": {
    "aurora-stdio": {
      "command": "node",
      "args": ["C:/path/to/CMS/apps/mcp/dist/index.js"],
      "env": {
        "CMS_API_URL": "https://aurora-api.example.com",
        "CMS_USER_TOKEN": "aur_u_YOUR_PERSONAL_TOKEN",
        "CMS_WEBSITE_ID": "OPTIONAL_DEFAULT_WEBSITE_ID"
      }
    }
  }
}
```

From the monorepo after build:

```bash
pnpm --filter @cms/mcp build
pnpm --filter @cms/mcp start
```

## First checks for agents

1. Call `whoami` — confirm user, active website, and **role**.
2. If no website is active: `list_websites` → `select_website`.
3. Prefer `str_replace_field` for small text edits; use `write_field` / `update_entry` for larger changes.
4. `publish_entry` before expecting public API / frontend updates.
5. Schema tools require builder/admin — editors get the same API denials as in Studio.

## Tool catalog (summary)

**Meta:** `whoami`, `list_websites`, `select_website`, `health`

**Schema:** `list_content_types`, `get_content_type`, `create_content_type`, `update_content_type`, `delete_content_type`, `create_field`, `update_field`, `delete_field`

**Entries:** `list_entries`, `get_entry`, `create_entry`, `update_entry`, `delete_entry`, `publish_entry`, `unpublish_entry`, `write_field`, `str_replace_field`, `create_preview_token`, `verify_entry_password`, `verify_entry_credentials`, `provision`

**Forms:** `list_forms`, `get_form`, `create_form`, `update_form`, `delete_form`, form field CRUD, submission list/get/mark-read/delete

**Website / media / packages:** `get_website`, `update_website`, `upload_media`, `export_package`, `import_package`

**Public (needs site key):** `cors_check`, `get_openapi`, `get_bootstrap`, `list_content_types_public`, `get_content_type_schema`, `list_published_entries`, `get_published_entry`

**Resources:** `aurora://website`, `aurora://content-types`, `aurora://content-types/{apiId}`, (+ `aurora://openapi` and `…/schema` when public read is enabled at start)

**Prompts:** `site_builder`, `frontend_brief`, `content_editor`

## Token lifecycle

### Personal access tokens (recommended)

1. Sign in to Studio.
2. **Settings** → **Personal access tokens** → create → copy `aur_u_…` once.
3. Put it in the hosted MCP `Authorization` header, or in stdio env as `CMS_USER_TOKEN` only (user secrets / local mcp.json).
4. Switch projects with `select_website` — no Cursor env edits.
5. Rotate by revoking the token in Studio when compromised or unused.

### Website-scoped tokens (legacy / automation)

1. Sign in on the target website (builder/admin).
2. **Utilities** → **API tokens** → create → copy `aur_…`.
3. Put it in `CMS_MANAGEMENT_TOKEN` (stdio) or the hosted Bearer. Cannot switch websites.

## Related docs

- [management-api.md](./management-api.md) — HTTP write API that MCP wraps
- [public-api.md](./public-api.md) — public read
- [frontend-playbook.md](./frontend-playbook.md) — frontend agents after schema changes
- [deploy-raspberry-pi.md](./deploy-raspberry-pi.md) — `/mcp` is served on the existing `aurora-api` hostname
