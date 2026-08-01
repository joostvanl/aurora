# Typed client (`@cms/shared`)

The monorepo package `@cms/shared` exports Zod schemas and `CmsClient`.

## Create a public client

```ts
import { createCmsClient } from "@cms/shared";

const cms = createCmsClient({
  baseUrl: process.env.NEXT_PUBLIC_CMS_API_URL!,
  siteKey: process.env.NEXT_PUBLIC_CMS_SITE_KEY!,
});

const types = await cms.listContentTypes();
const { items } = await cms.listPublishedEntries("post", { limit: 10 });
const home = await cms.getPublishedEntry("page", "home");
```

## Important methods (public)

| Method | Behavior |
|--------|----------|
| `listContentTypes()` | Public list (`x-site-key`) |
| `listPublishedEntries(apiId, params?)` | Published list |
| `getPublishedEntry(apiId, slug)` | One published entry |
| `getPublishedForm(apiId)` | Form schema (`x-site-key`) |
| `submitForm(apiId, { fields })` | Public form submit |
| `getContentType(apiId)` | Uses **admin** path if `token` is set; otherwise public |

Admin form helpers: `listForms`, `getForm`, `createForm`, field CRUD, `listFormSubmissions`, etc. See [forms.md](./forms.md).

Do **not** pass a JWT into a public website client unless you intentionally call admin APIs.

## Outside the monorepo

You can call the HTTP API directly with `fetch` and `x-site-key` — no package required. See [public-api.md](./public-api.md).
