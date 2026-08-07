import { describe, expect, it } from "vitest";
import {
  assertRateLimit,
  clearDefaultRateLimitStore,
  clientIpFromHeaders,
} from "./rateLimit.js";

describe("assertRateLimit", () => {
  it("allows up to max events inside the window", () => {
    const store = new Map<string, number[]>();
    for (let i = 0; i < 3; i++) {
      assertRateLimit("k", { windowMs: 60_000, max: 3, store });
    }
    expect(() =>
      assertRateLimit("k", { windowMs: 60_000, max: 3, store }),
    ).toThrow(/too many/i);
  });

  it("isolates keys", () => {
    const store = new Map<string, number[]>();
    assertRateLimit("a", { windowMs: 60_000, max: 1, store });
    expect(() =>
      assertRateLimit("a", { windowMs: 60_000, max: 1, store }),
    ).toThrow();
    expect(() =>
      assertRateLimit("b", { windowMs: 60_000, max: 1, store }),
    ).not.toThrow();
  });

  it("clears the default store helper", () => {
    clearDefaultRateLimitStore();
    assertRateLimit("default-key", { windowMs: 60_000, max: 1 });
    expect(() =>
      assertRateLimit("default-key", { windowMs: 60_000, max: 1 }),
    ).toThrow();
    clearDefaultRateLimitStore();
    expect(() =>
      assertRateLimit("default-key", { windowMs: 60_000, max: 1 }),
    ).not.toThrow();
    clearDefaultRateLimitStore();
  });
});

describe("clientIpFromHeaders", () => {
  it("prefers first x-forwarded-for hop", () => {
    expect(
      clientIpFromHeaders({
        headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
        ip: "127.0.0.1",
      }),
    ).toBe("1.2.3.4");
  });

  it("falls back to request ip", () => {
    expect(clientIpFromHeaders({ headers: {}, ip: "9.9.9.9" })).toBe("9.9.9.9");
  });
});
