# Content model

## Hierarchy

```
User (account / tenant)
 └── ContentType (apiId e.g. "post")
      ├── FieldDefinition[] (apiId e.g. "title", type e.g. "text")
      └── Entry[]
           ├── slug (URL key for this entry)
           ├── status: draft | published
           ├── locale (default "en")
           └── EntryFieldValue[] → serialized as fields: { [fieldApiId]: value }
```

## Content type

A content type is a named schema.

| Property | Meaning |
|----------|---------|
| `id` | Internal cuid |
| `apiId` | Stable machine id used in URLs (`post`, `nav_item`) — **use this in API paths** |
| `name` | Human label |
| `description` | Optional |
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
| `textarea` | string (longer) |
| `richtext` | string (plain or light markup; treat as text unless you know otherwise) |
| `boolean` | boolean |
| `datetime` | ISO-8601 string |
| `number` | number |
| `slug` | string (URL-safe fragment) |
| `media` | string — public image URL (uploaded via admin or pasted) |

## Entry

| Property | Meaning |
|----------|---------|
| `id` | Internal id (admin uses this; public often uses `slug`) |
| `slug` | **Path key** for public `…/entries/:slug` |
| `contentType` | Parent type’s `apiId` (string) |
| `status` | `draft` \| `published` |
| `locale` | Default `en` (public API has no locale query yet) |
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

There are **no foreign-key relations** in the API. Links are conventions via string fields, e.g.:

- `post.fields.authorSlug` → look up `author` entry with that slug
- `nav_item.fields.href` → frontend route path

Resolve these with a second fetch or by joining in your app after listing both collections.

## Empty CMS

New account → `GET /api/v1/content-types` returns `[]`.  
Your frontend must render an empty state, not assume `page` / `post` exist.
