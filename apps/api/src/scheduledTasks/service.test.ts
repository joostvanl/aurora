import { describe, expect, it } from "vitest";
import {
  assertScheduleFields,
  computeInitialNextRunAt,
} from "./service.js";
import { wallTimeToUtc } from "./nextRunAt.js";

const TZ = "Europe/Amsterdam";

describe("computeInitialNextRunAt", () => {
  it("sets first daily fire on start day", () => {
    const startAt = wallTimeToUtc(2026, 4, 1, 0, 0, TZ);
    const next = computeInitialNextRunAt({
      frequency: "daily",
      timeOfDay: "08:00",
      timeZone: TZ,
      byWeekday: null,
      byMonthDay: null,
      startAt,
      endAt: null,
    });
    expect(next?.toISOString()).toBe(
      wallTimeToUtc(2026, 4, 1, 8, 0, TZ).toISOString(),
    );
  });

  it("rejects weekly without byWeekday", () => {
    expect(() =>
      assertScheduleFields({
        frequency: "weekly",
        timeOfDay: "09:00",
        timeZone: TZ,
        byWeekday: null,
        byMonthDay: null,
        startAt: new Date(),
        endAt: null,
      }),
    ).toThrow(/byWeekday/);
  });
});
