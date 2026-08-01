# Content model

## Hierarchy

```
User (account / tenant) / Website
 ├── locales[] + defaultLocale (BCP-47 language-REGION, e.g. en-US, nl-NL)
 └── ContentType (apiId e.g. "post")
      ├── localizationMode: explicit | all_locales
      ├── FieldDefinition[] (apiId e.g. "title", type e.g. "text")
      └── Entry[]
           ├── slug (URL key for this entry)
           ├── status: draft | published
           ├── locale (must be in Website.locales; default website.defaultLocale)
           └── EntryFieldValue[] → serialized as fields: { [fieldApiId]: value }
```

## Website locales

| Property | Meaning |
|----------|---------|
| `locales` | Enabled BCP-47 tags (`en-US`, `nl-NL`, …) |
| `defaultLocale` | Used when public/admin omit `?locale=` |

## Content type

A content type is a named schema.

| Property | Meaning |
|----------|---------|
| `id` | Internal cuid |
| `apiId` | Stable machine id used in URLs (`post`, `nav_item`) — **use this in API paths** |
| `name` | Human label |
| `description` | Optional |
| `localizationMode` | `explicit` (default): translations created on demand. `all_locales`: creating an entry also creates draft siblings for every site locale |
| `fields` | Ordered field definitions |

`apiId` rules (when creating): `^[a-z][a-z0-9_]*$`

## Field definition

| Property | Meaning |
|----------|---------|
| `apiId` | Key inside `entry.fields` |
| `name` | Editor label |
| `type` | See below |
| `required` | Editor/validation intent |
| `sortOrder` | Order of fields in admin (not entry list sort) |

### Field types

| Type | Typical JSON value |
|------|--------------------|
| `text` | string |
| `richtext` | string — **HTML** from the TipTap editor (`settings.contentFormat` = `html`) |
| `textarea` | string — default `plain`; may be `markdown` (e.g. docs `body`) |
| `media` | `{ url, alt?, width?, height?, mimeType? }` (legacy URL string still accepted) |
| `relation` | string — slug of one related entry (`settings.relatedContentTypeApiId`) |
| `relations` | string[] — slugs of related entries (multi-select) |

Field definitions may include optional `settings` (JSON):

```json
{
  "relatedContentTypeApiId": "author",
  "contentFormat": "markdown"
}
```

`contentFormat` is always present on **serialized** field defs (`html` | `markdown` | `plain`). Defaults: `richtext`→`html`, `text`/`textarea`→`plain`.

For `relation` / `relations`, `relatedContentTypeApiId` is required.

## Entry

| Property | Meaning |
|----------|---------|
| `id` | Internal id (admin uses this; public often uses `slug`) |
| `slug` | **Path key** for public `…/entries/:slug` |
| `contentType` | Parent type’s `apiId` (string) |
| `status` | `draft` \| `published` |
| `locale` | BCP-47 language-REGION (e.g. `en-US`). Must be in `Website.locales`. Public list/get filter with `?locale=` (defaults to `defaultLocale`) |
| `fields` | `Record<string, unknown>` keyed by field `apiId` |
| `publishedAt` | ISO string or `null` |
| `createdAt` / `updatedAt` | ISO strings |

### Slug vs field `slug`

Many types also have a **field** named `slug` inside `fields`.

- Public URL / API path uses **`entry.slug`** (top-level).
- The field `fields.slug` is editorial data and *should* match, but always use top-level `entry.slug` for routing.

Uniqueness: `(contentTypeId, slug, locale)`.

## Publishing rules

| Action | Public visibility |
|--------|-------------------|
| `status: draft` | **Hidden** from public API |
| `status: published` | **Visible** on public API |
| Unpublish | Becomes draft; `publishedAt` cleared |

Public list/get handlers **hard-filter** published. You cannot request drafts with the public API even if you pass `?status=draft`.

New entries default to **draft** unless created as published or later published in admin.

## Discovering the model at runtime

Never hard-code types as the only source of truth for an arbitrary account. Always:

1. `GET /api/v1/content-types` with `x-site-key`
2. Inspect each type’s `fields`
3. Fetch entries for the types you need

For the **seeded demo**, types are known in advance — see [demo-content-map.md](./demo-content-map.md). Still prefer discovering fields when rendering generic UIs.

## Relations between entries

Use field types **`relation`** (single select) and **`relations`** (multi select). Stored values are related entry **slugs** (string / string[]). There are no database foreign keys — resolve with a second fetch:

- `post.fields.authors` → `["mira-vale", "jonas-reed"]` → fetch each `author` by slug
- `nav_item.fields.href` → frontend route path (plain text, not a CMS relation)

Public API does not auto-expand related entries; join in your app after listing both collections.

## Empty CMS

New account → `GET /api/v1/content-types` returns `[]`.  
Your frontend must render an empty state, not assume `page` / `post` exist.
