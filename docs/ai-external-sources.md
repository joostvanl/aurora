# Studio-AI external sources (MCP client)

Studio-AI can call **configured** Streamable HTTP MCP servers and use the
results as ground truth when writing **draft** CMS entries.

This is the opposite of Aurora’s hosted MCP **server** at [`/mcp`](./mcp.md)
(CMS-59): Cursor talks *to* Aurora there. Here, the in-app agent is an MCP
**client**. Do not reuse `apps/mcp` as the client stack.

## Configure

Admin → **Settings** → **Databronnen** (`/data-sources`), per website, max 8:

- Label, `https://` MCP URL, enabled flag
- One auth header (default `Authorization`); the value is write-only
- Private / localhost / RFC1918 URLs are rejected on save and on every call
  (same SSRF gate as `fetch_url`)

GET never returns the raw secret (`authConfigured` + `authPreview` only).
Editors may read the masked list; only admins can PUT. Empty secret on update
keeps the stored value; `clearAuth` wipes it.

## Agent tools (core — also scheduled tasks)

1. `list_external_sources` — enabled sources for the **active** website (`id`,
   `label`, `type`). No URL or secret.
2. `list_external_source_tools` — MCP `initialize` + `tools/list`
3. `call_external_source` — MCP `tools/call`

The model cannot pass an ad-hoc URL. Unknown, disabled, or other-website
`sourceId` → `ok: false`. Failures must not be filled in with invented facts.

Write the article with existing `create_entry` (default draft + defaultLocale).
There is no `write_article_from_source` tool. `allowPublish` on a scheduled
task remains the only unattended publish path.

## `fetch_url` vs MCP

| Use | Tool |
| --- | --- |
| Ordinary public HTML/JSON page | `fetch_url` |
| Configured structured MCP API | the three external-source tools |

Do not hardcode a product MCP URL in the app. Add each source in Databronnen.
