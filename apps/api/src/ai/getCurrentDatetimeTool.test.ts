import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({
  prisma: {},
}));

vi.mock("./webFetch.js", () => ({
  fetchPublicUrl: vi.fn(),
  WebFetchError: class WebFetchError extends Error {},
}));

import { executeAiTool } from "./tools.js";

describe("get_current_datetime tool", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("returns authoritative server time payload", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T07:30:00.000Z"));

    const result = await executeAiTool(
      "get_current_datetime",
      {},
      { websiteId: "ws1", role: "admin" },
    );

    expect(result.ok).toBe(true);
    expect(result.name).toBe("get_current_datetime");
    expect(result.data).toMatchObject({
      utcIso: "2026-08-12T07:30:00.000Z",
      timeZone: "Europe/Amsterdam",
      date: "2026-08-12",
      time: "09:30:00",
      localIso: "2026-08-12T09:30:00",
      weekday: "Wednesday",
    });
    expect(result.summary).toMatch(/Europe\/Amsterdam/);
  });
});
