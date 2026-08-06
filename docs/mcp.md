# Aurora MCP server

Local **Model Context Protocol** server so coding agents (Cursor, Claude Desktop, MCP Inspector) can manage Aurora websites through the Management API.

This is **not** a public internet endpoint. Prefer a **user personal access token** (`aur_u_…`) so one Cursor config works across all websites you belong to. Website-scoped `aur_…` tokens remain supported for automation. The package lives at `apps/mcp` (`@cms/mcp`).

## Security model

| Rule | Detail |
|------|--------|
| Transport | **stdio** only (v1). The host launches the process; nothing listens on a port. |
| Preferred auth | `CMS_USER_TOKEN` (`aur_u_…`). Rights = your **membership role** on the active website. |
| Legacy auth | `CMS_MANAGEMENT_TOKEN` (`aur_…`) bound to **one** website with admin privileges. |
| Website switch | With a user PAT: `list_websites` → `select_website` (no env edits). |
| Session JWT | After `select_website`, MCP uses the returned JWT for management calls. Re-select if it expires (~7d); the PAT stays in env. |
| Default site | Optional `CMS_WEBSITE_ID` auto-selects on start (does not block later switches). |
| Site key | Optional `CMS_SITE_KEY` for public-read tools; after select, MCP can use the API `siteKey` when env is unset. |
| No login tool | Do not put passwords in the agent chat; create tokens in Studio. |

Cross-tenant isolation is enforced by the API. MCP only forwards Bearer credentials.

## Requirements

- Node 20+
- Built package: `pnpm --filter @cms/mcp build`
- API reachable at `CMS_API_URL`
- Personal access token from Studio → **Settings** → **Personal access tokens**

## Environment

| Variable | Required | Meaning |
|----------|----------|---------|
| `CMS_API_URL` | yes | e.g. `http://localhost:4000` or production API URL |
| `CMS_USER_TOKEN` | preferred | `aur_u_…` personal access token |
| `CMS_MANAGEMENT_TOKEN` | legacy | `aur_…` website token (still supported) |
| `CMS_WEBSITE_ID` | optional | Default website to auto-select on start |
| `CMS_SITE_KEY` | optional | Enables / pins public tools to this site key |

## Cursor config

Copy [`apps/mcp/mcp.json.example`](../apps/mcp/mcp.json.example) into your Cursor MCP config (`~/.cursor/mcp.json`) and fill placeholders. **Never commit real tokens.**

Example (paths adjusted for your machine):

```json
{
  "mcpServers": {
    "aurora": {
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

After changing MCP env in Cursor, refresh the MCP server list (or reload the window).

## First checks for agents

1. Call `whoami` — confirm user, active website, and **role**.
2. If no website is active: `list_websites` → `select_website`.
3. Prefer `str_replace_field` for small text edits; use `write_field` / `update_entry` for larger changes.
4. `publish_entry` before expecting public API / frontend updates.
5. Schema tools require builder/admin — editors get the same API denials as in Studio.

## Tool catalog (summary)

**Meta:** `whoami`, `list_websites`, `select_website`, `health`

**Schema:** `list_content_types`, `get_content_type`, `create_content_type`, `update_content_type`, `delete_content_type`, `create_field`, `update_field`, `delete_field`

**Entries:** `list_entries`, `get_entry`, `create_entry`, `update_entry`, `delete_entry`, `publish_entry`, `unpublish_entry`, `write_field`, `str_replace_field`, `create_preview_token`, `provision`

**Forms:** `list_forms`, `get_form`, `create_form`, `update_form`, `delete_form`, form field CRUD, submission list/get/mark-read/delete

**Website / media / packages:** `get_website`, `update_website`, `upload_media`, `export_package`, `import_package`

**Public (needs site key):** `cors_check`, `get_openapi`, `get_bootstrap`, `list_content_types_public`, `get_content_type_schema`, `list_published_entries`, `get_published_entry`

**Resources:** `aurora://website`, `aurora://content-types`, `aurora://content-types/{apiId}`, (+ `aurora://openapi` and `…/schema` when public read is enabled at start)

**Prompts:** `site_builder`, `frontend_brief`, `content_editor`

## Token lifecycle

### Personal access tokens (recommended)

1. Sign in to Studio.
2. **Settings** → **Personal access tokens** → create → copy `aur_u_…` once.
3. Put it in MCP env as `CMS_USER_TOKEN` only (user secrets / local mcp.json).
4. Switch projects with `select_website` — no Cursor env edits.
5. Rotate by revoking the token in Studio when compromised or unused.

### Website-scoped tokens (legacy / automation)

1. Sign in on the target website (builder/admin).
2. **Utilities** → **API tokens** → create → copy `aur_…`.
3. Put it in `CMS_MANAGEMENT_TOKEN`. Cannot switch websites.

## Related docs

- [management-api.md](./management-api.md) — HTTP write API that MCP wraps
- [public-api.md](./public-api.md) — public read
- [frontend-playbook.md](./frontend-playbook.md) — frontend agents after schema changes
