/**
 * Lightweight event hooks for future plugins / webhooks.
 * Register listeners with `hooks.on(event, handler)`.
 */

export type CmsHookEvents = {
  onEntryPublish: {
    entryId: string;
    contentTypeApiId: string;
    slug: string;
  };
  onEntryUnpublish: {
    entryId: string;
    contentTypeApiId: string;
    slug: string;
  };
  onEntryCreate: {
    entryId: string;
    contentTypeApiId: string;
    slug: string;
  };
  onEntryUpdate: {
    entryId: string;
    contentTypeApiId: string;
    slug: string;
  };
};

type Handler<T> = (payload: T) => void | Promise<void>;

class HookBus {
  private listeners = new Map<keyof CmsHookEvents, Array<Handler<unknown>>>();

  on<K extends keyof CmsHookEvents>(event: K, handler: Handler<CmsHookEvents[K]>) {
    const list = this.listeners.get(event) ?? [];
    list.push(handler as Handler<unknown>);
    this.listeners.set(event, list);
    return () => this.off(event, handler);
  }

  off<K extends keyof CmsHookEvents>(event: K, handler: Handler<CmsHookEvents[K]>) {
    const list = this.listeners.get(event);
    if (!list) return;
    this.listeners.set(
      event,
      list.filter((h) => h !== handler),
    );
  }

  async emit<K extends keyof CmsHookEvents>(event: K, payload: CmsHookEvents[K]) {
    const list = this.listeners.get(event) ?? [];
    for (const handler of list) {
      await handler(payload);
    }
  }
}

export const hooks = new HookBus();
