# Plugins

Place optional CMS plugins here. In v1 this folder is a stub.

## Convention

1. Export a `register()` function (or Fastify plugin) from your module.
2. Wire it in `index.ts` via `registerPlugins()`.
3. Prefer the typed event bus in `../core/hooks.ts` for side effects
   (`onEntryPublish`, `onEntryCreate`, …) instead of patching route handlers.

Future ideas: webhooks, search indexing, custom field types, RBAC providers.
