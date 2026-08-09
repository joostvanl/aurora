import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

describe("scheduled tasks routes", () => {
  const appPromise = buildApp({ logger: false });

  afterAll(async () => {
    const app = await appPromise;
    await app.close();
  });

  it("rejects unauthenticated list with 401", async () => {
    const app = await appPromise;
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/scheduled-tasks",
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("rejects unauthenticated create with 401", async () => {
    const app = await appPromise;
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/admin/scheduled-tasks",
      headers: { "content-type": "application/json" },
      payload: {
        name: "Test",
        prompt: "Do something",
        frequency: "daily",
        timeOfDay: "09:00",
        startAt: "2026-03-01T00:00:00.000Z",
      },
    });
    expect(res.statusCode).toBe(401);
  });
});
