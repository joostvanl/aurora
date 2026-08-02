# Aurora MCP server

Local **Model Context Protocol** server so coding agents (Cursor, Claude Desktop, MCP Inspector) can manage **one Aurora website** through the existing Management API.

This is **not** a public internet endpoint. Authorization is the same as the Management API: a website-scoped `aur_…` token. The package lives at `apps/mcp` (`@cms/mcp`).

## Security model

| Rule | Detail |
|------|--------|
| Transport | **stdio** only (v1). The host launches the process; nothing listens on a port. |
| Write access | Requires `CMS_MANAGEMENT_TOKEN` (`aur_…`). Token is bound to **one** `websiteId` by the API. |
| Startup gate | Process **exits** if the token is missing or rejected by `GET /api/v1/admin/website`. |
| Tenant pin | Set `CMS_WEBSITE_ID` to the expected website id; mismatch → refuse to start. |
| Site key | Optional `CMS_SITE_KEY` for public-read tools only. Must equal the token website’s site key. |
| No anonymous mode | Without a management token the server does not start (no site-key-only MCP). |
| No login tool | Do not put passwords in the agent chat; create tokens in Admin → **Utilities** → **API tokens**. |

Cross-tenant isolation is enforced by the API (`request.user.websiteId`). MCP only forwards the Bearer token.

## Requirements

- Node 20+
- Built package: `pnpm --filter @cms/mcp build`
- API reachable at `CMS_API_URL`
- Website API token created while logged into that website

## Environment

| Variable | Required | Meaning |
|----------|----------|---------|
| `CMS_API_URL` | yes | e.g. `http://localhost:4000` or `https://aurora-api.joostvanleeuwaarden.com` |
| `CMS_MANAGEMENT_TOKEN` | yes | `aur_…` for **that** website |
| `CMS_WEBSITE_ID` | recommended | Pin to website id (from Admin / MCP tool `whoami`) |
| `CMS_SITE_KEY` | optional | Enables public tools; must match the same website |

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
        "CMS_API_URL": "https://aurora-api.joostvanleeuwaarden.com",
        "CMS_MANAGEMENT_TOKEN": "aur_YOUR_WEBSITE_TOKEN",
        "CMS_WEBSITE_ID": "YOUR_WEBSITE_ID",
        "CMS_SITE_KEY": "your-site-key"
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

1. Call `whoami` — confirm website id/name match the site you intend to edit.
2. Prefer `str_replace_field` for small text edits; use `write_field` / `update_entry` for larger changes.
3. `publish_entry` before expecting public API / frontend updates.
4. Public discover tools (`get_bootstrap`, `list_published_entries`, …) need a matching `CMS_SITE_KEY`.

## Tool catalog (summary)

**Meta:** `whoami`, `health`

**Schema:** `list_content_types`, `get_content_type`, `create_content_type`, `update_content_type`, `delete_content_type`, `create_field`, `update_field`, `delete_field`

**Entries:** `list_entries`, `get_entry`, `create_entry`, `update_entry`, `delete_entry`, `publish_entry`, `unpublish_entry`, `write_field`, `str_replace_field`, `create_preview_token`, `provision`

**Forms:** `list_forms`, `get_form`, `create_form`, `update_form`, `delete_form`, form field CRUD, submission list/get/mark-read/delete

**Website / media / packages:** `get_website`, `update_website`, `upload_media`, `export_package`, `import_package`

**Public (needs matching `CMS_SITE_KEY`):** `cors_check`, `get_openapi`, `get_bootstrap`, `list_content_types_public`, `get_content_type_schema`, `list_published_entries`, `get_published_entry`

**Resources:** `aurora://website`, `aurora://content-types`, `aurora://content-types/{apiId}`, (+ `aurora://openapi` and `…/schema` when public read is enabled)

**Prompts:** `site_builder`, `frontend_brief`, `content_editor`

## Token lifecycle

1. Sign in to Admin on the target website (builder/admin as required for token creation).
2. **Utilities** → **API tokens** → create → copy `aur_…` once.
3. Put it in MCP env only (user secrets / local mcp.json).
4. Rotate by deleting the token in Admin when compromised or unused.

## Related docs

- [management-api.md](./management-api.md) — HTTP write API that MCP wraps
- [public-api.md](./public-api.md) — public read
- [frontend-playbook.md](./frontend-playbook.md) — frontend agents after schema changes
