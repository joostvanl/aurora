import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { clearDefaultRateLimitStore } from "../lib/rateLimit.js";

describe("auth rate limits", () => {
  const appPromise = buildApp({ logger: false });

  beforeEach(() => {
    clearDefaultRateLimitStore();
  });

  afterAll(async () => {
    const app = await appPromise;
    await app.close();
  });

  it("returns 429 after too many login attempts for the same email/IP", async () => {
    const app = await appPromise;
    const payload = {
      email: "ratelimit-login@example.com",
      password: "wrong-password",
    };

    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.50",
        },
        payload,
      });
      lastStatus = res.statusCode;
      if (i < 10) {
        expect(res.statusCode).toBe(401);
      }
    }
    expect(lastStatus).toBe(429);
    const body = (
      await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.50",
        },
        payload,
      })
    ).json() as { code?: string };
    expect(body.code).toBe("RATE_LIMITED");
  });
});
