# Errors and gotchas

## Error shape and request IDs

API errors from the global handler look like:

```json
{
  "message": "Entry not found",
  "code": "ENTRY_NOT_FOUND",
  "requestId": "a1b2c3d4-…"
}
```

Every response also includes header `X-Request-Id` (same value). Clients may send `x-request-id` or `x-correlation-id` to reuse an id across services.

To correlate a client error with production logs on the Pi:

```bash
cd ~/aurora/deploy
docker compose logs -f api | grep '<requestId>'
```

Production API logs are structured JSON (`LOG_LEVEL`, default `info`). There is no central log stack (Loki/Datadog) yet — see [deploy-raspberry-pi.md](./deploy-raspberry-pi.md).

The typed client exposes `CmsApiError.requestId` when the header or JSON body includes it.

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
9. **Scheduled tasks (Taken)** run the full AI agent unattended and are **draft-only** — they cannot publish. Disable the poller with `CMS_SCHEDULED_TASKS=0`. Check `lastStatus` / `lastError` on the task when a run fails.

## Health check first

```bash
curl -s http://localhost:4000/health
```

If this fails, fix the API before debugging the frontend.
