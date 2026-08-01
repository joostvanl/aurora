/**
 * Plugin convention (v1 stub):
 * - Drop Fastify plugins or hook subscribers in this folder
 * - Register them from `src/plugins/index.ts`
 * - Prefer listening on events from `../core/hooks.ts` (e.g. onEntryPublish)
 */

export async function registerPlugins() {
  // Example:
  // hooks.on("onEntryPublish", async (payload) => { ... });
}
