# Errors and gotchas

## Common failures

| Symptom | Likely cause |
|---------|----------------|
| 401 on content | Missing/invalid `x-site-key` |
| Empty lists | Wrong site key, or nothing published |
| 404 on entry | Bad slug, draft-only, or type missing |
| CORS error in browser | Frontend origin not allowed — use `GET /api/v1/cors-check?origin=…`; localhost/127.0.0.1 any port are allowed; else add `allowedOrigins` |
| Nav order looks random | Pass `?sort=sortOrder&order=asc` (or sort client-side by `fields.sortOrder`) |
| Wrong richtext renderer | Read `settings.contentFormat` — richtext is HTML; docs body is markdown |
| “Fields undefined” | Reading `entry.title` instead of `entry.fields.title` |

## Gotchas

1. **Public API ignores draft content** completely.
2. **List default `limit` is 20** — use `limit=50` (max 100) for nav.
3. **`Entry.slug` vs `fields.slug`** — route with top-level `slug`.
4. **Locales** — BCP-47 tags like `en-US` / `nl-NL`. Public list/get use `?locale=` or the website `defaultLocale`. Wrong locale → empty list / 404.
5. **Register = empty CMS** — not the seeded demo.
6. **Site key ≠ JWT** — never swap them.
7. **AI config is per website** (admin only); chat runs in the studio dock within the user’s role.
8. **`media` fields** store a public image URL (upload via `POST /api/v1/admin/media` or paste). Default storage is local disk under `/uploads/{websiteId}/`. Per website you can switch to ImageKit (Settings → Media storage); then uploads return an ImageKit CDN URL instead.

## Health check first

```bash
curl -s http://localhost:4000/health
```

If this fails, fix the API before debugging the frontend.
