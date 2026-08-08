import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";

describe("buildApp observability", () => {
  const appPromise = buildApp({ logger: false });

  afterAll(async () => {
    const app = await appPromise;
    await app.close();
  });

  it("serves /health with an X-Request-Id header", async () => {
    const app = await appPromise;
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    const requestId = res.headers["x-request-id"];
    expect(typeof requestId).toBe("string");
    expect(String(requestId).length).toBeGreaterThan(0);
  });

  it("echoes an incoming x-request-id", async () => {
    const app = await appPromise;
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "test-fixed-id" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-request-id"]).toBe("test-fixed-id");
  });

  it("includes requestId in error JSON from the global handler", async () => {
    const app = await appPromise;
    // Invalid login body → ZodError → global error handler (not reply.send shortcuts).
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: {
        "content-type": "application/json",
        "x-request-id": "err-correlate-1",
      },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers["x-request-id"]).toBe("err-correlate-1");
    const body = res.json() as {
      message?: string;
      code?: string;
      requestId?: string;
    };
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(body.requestId).toBe("err-correlate-1");
  });

  it("still sets X-Request-Id when auth middleware reply.sends 401", async () => {
    const app = await appPromise;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/content-types/page/entries",
      headers: {
        "content-type": "application/json",
        "x-request-id": "auth-shortcut-1",
      },
      payload: { slug: "hello-world", fields: {} },
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers["x-request-id"]).toBe("auth-shortcut-1");
  });

  it("honors x-correlation-id when x-request-id is absent", async () => {
    const app = await appPromise;
    const res = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-correlation-id": "corr-abc" },
    });
    expect(res.headers["x-request-id"]).toBe("corr-abc");
  });
});
