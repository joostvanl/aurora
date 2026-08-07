import { httpError } from "./httpError.js";

export type RateLimitOptions = {
  /** Sliding window length in ms. */
  windowMs: number;
  /** Max events allowed inside the window. */
  max: number;
  /** Optional shared store (tests). */
  store?: Map<string, number[]>;
  /** Error message when limited. */
  message?: string;
};

const defaultStore = new Map<string, number[]>();

/**
 * In-memory sliding-window rate limit.
 * Suitable for single-instance deploys (same model as form submit).
 */
export function assertRateLimit(key: string, options: RateLimitOptions): void {
  const store = options.store ?? defaultStore;
  const now = Date.now();
  const timestamps = (store.get(key) ?? []).filter(
    (t) => now - t < options.windowMs,
  );
  if (timestamps.length >= options.max) {
    throw httpError(
      429,
      options.message ?? "Too many requests. Try again shortly.",
      "RATE_LIMITED",
    );
  }
  timestamps.push(now);
  store.set(key, timestamps);
}

/** Clear the default store (tests only). */
export function clearDefaultRateLimitStore() {
  defaultStore.clear();
}

export function clientIpFromHeaders(input: {
  headers: Record<string, unknown>;
  ip?: string;
}): string {
  const forwarded = input.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  if (Array.isArray(forwarded) && typeof forwarded[0] === "string") {
    return forwarded[0].split(",")[0]?.trim() || "unknown";
  }
  return input.ip || "unknown";
}
