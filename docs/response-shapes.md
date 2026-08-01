# Response shapes

All public responses are JSON. Dates are ISO-8601 strings.

## ContentType

Returned by `GET /api/v1/content-types` and `GET /api/v1/content-types/:apiId`.

```json
{
  "id": "clx...",
  "apiId": "post",
  "name": "Post",
  "description": "Blog posts",
  "fields": [
    {
      "id": "clx...",
      "apiId": "title",
      "name": "Title",
      "type": "text",
      "required": true,
      "sortOrder": 0
    }
  ],
  "createdAt": "2026-07-28T00:00:00.000Z",
  "updatedAt": "2026-07-28T00:00:00.000Z"
}
```

## FlatEntry

Returned for every entry (list item or single).

```json
{
  "id": "clx...",
  "slug": "hello-aurora",
  "contentType": "post",
  "status": "published",
  "locale": "en",
  "fields": {
    "title": "Hello, Aurora",
    "excerpt": "...",
    "body": "...",
    "category": "Product",
    "authorSlug": "mira-vale",
    "readingMinutes": 3,
    "publishedDate": "2026-07-28T00:00:00.000Z"
  },
  "publishedAt": "2026-07-28T00:00:00.000Z",
  "createdAt": "2026-07-28T00:00:00.000Z",
  "updatedAt": "2026-07-28T00:00:00.000Z"
}
```

### Critical parsing rules

1. **Content lives in `fields`**, not as top-level keys (except `slug`, `status`, …).
2. **`slug` (top-level)** is the URL key for `GET .../entries/:slug`.
3. Many types also store a **`fields.slug`** string for editors — prefer top-level `entry.slug` for routing.
4. Field values are JSON: strings, numbers, booleans, or richer JSON depending on type.
5. `richtext` / `textarea` are plain strings (often markdown-ish or paragraphs separated by `\n\n`). Render as you prefer; this site treats them as text with line breaks.

## Paginated list

```json
{
  "items": [ /* FlatEntry[] */ ],
  "total": 42,
  "limit": 20,
  "offset": 0
}
```

## Error body

```json
{ "message": "Human readable error" }
```

Validation failures may include `"issues"` (Zod). Common statuses: `400`, `401`, `404`, `409`.
