# Forms

Aurora forms are a **separate module** from content types/entries. Editors build forms in the admin studio; frontends load the schema and submit with the public `x-site-key`.

Submissions are **not** published content — they live in an admin inbox.

---

## Concepts

| Concept | Role |
|---------|------|
| `Form` | Named form with `apiId`, labels, success message, enabled flag |
| `FormField` | Field definition (`text`, `email`, `phone`, `textarea`, `number`, `select`, `radio`, `checkbox`, `honeypot`) |
| `FormSubmission` | Stored payload + light meta (user-agent, IP hash, referer) |

`honeypot` fields are returned in the public schema so the client can render a hidden input. Non-empty honeypot values are rejected.

---

## Public API (`x-site-key`)

### `GET /api/v1/forms/:apiId`

Returns the form schema when `enabled` is true. 404 otherwise.

### `POST /api/v1/forms/:apiId/submit`

```json
{
  "fields": {
    "name": "Ada",
    "email": "ada@example.com",
    "message": "Hello",
    "company_url": ""
  }
}
```

- Unknown keys → `400`
- Required / type validation server-side
- Rate limit: ~10 submits / minute / siteKey+IP
- Response: `{ "ok": true, "message": "<successMessage>" }`

---

## Admin API (`Authorization: Bearer`)

| Method | Path |
|--------|------|
| GET/POST | `/api/v1/admin/forms` |
| GET/PATCH/DELETE | `/api/v1/admin/forms/:apiId` |
| POST/PATCH/DELETE | `/api/v1/admin/forms/:apiId/fields[/:fieldApiId]` |
| GET | `/api/v1/admin/forms/:apiId/submissions` |
| GET/PATCH/DELETE | `/api/v1/admin/forms/:apiId/submissions/:id` |

PATCH submission body: `{ "read": true }` or `{ "read": false }`.

Studio UI: **Forms** in the admin sidebar (builder + inbox).

---

## AI assistant

The studio **AI dock** (right side, every page) operates forms with the same tool loop as content. Screen context (path, form id, entry id) is sent with each chat. Provider config lives under **AI settings**.

| Tool | Purpose |
|------|---------|
| `list_forms` / `get_form` | Inspect schemas |
| `create_form` / `update_form` / `delete_form` | Form CRUD |
| `create_form_field` / `update_form_field` / `delete_form_field` | Field CRUD |
| `form_submission_stats` | Totals, unread, recent payloads (insights first) |
| `list_form_submissions` / `get_form_submission` | Inbox detail |
| `mark_form_submission_read` / `delete_form_submission` | Triage |

Ask e.g. “Summariseer de contact-inzendingen” or “Voeg een phone-veld toe aan contact”.

After **approved content-type / field** schema changes (not routine entry edits), the assistant appends a **Frontend agent brief (copy-paste)** block so you can paste instructions into a frontend coding agent. The assistant must ask before making those structural changes.

---

## Embedding on a frontend

### 1. Component by `apiId`

```tsx
<CmsForm apiId="contact" />
```

(Demo product site: `apps/web/src/components/CmsForm.tsx`.)

Or with the typed client:

```ts
const form = await client.getPublishedForm("contact");
await client.submitForm("contact", { fields: { name, email, message } });
```

### 2. Page field `formApiId`

Content type `page` may include optional field `formApiId`. When set, the product site renders `<CmsForm apiId={formApiId} />` under the page body (see `/contact` seed: `formApiId: "contact"`).

---

## Demo seed

- Form `contact`: name, email, message + honeypot `company_url`
- Page `contact` links `formApiId: "contact"`

Not in V1: file uploads, email/webhook notifications, conditional fields, CAPTCHA (honeypot + rate limit only).
