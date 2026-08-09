import { describe, expect, it } from "vitest";
import { computeNextRunAt, parseTimeOfDay, wallTimeToUtc } from "./nextRunAt.js";

const TZ = "Europe/Amsterdam";

describe("parseTimeOfDay", () => {
  it("parses HH:mm", () => {
    expect(parseTimeOfDay("09:30")).toEqual({ hour: 9, minute: 30 });
    expect(parseTimeOfDay("23:05")).toEqual({ hour: 23, minute: 5 });
  });

  it("rejects invalid values", () => {
    expect(() => parseTimeOfDay("9:30")).toThrow(/Invalid timeOfDay/);
    expect(() => parseTimeOfDay("24:00")).toThrow(/Invalid timeOfDay/);
    expect(() => parseTimeOfDay("12:60")).toThrow(/Invalid timeOfDay/);
  });
});

describe("wallTimeToUtc", () => {
  it("maps Amsterdam winter time to UTC (+1)", () => {
    // 2026-01-15 10:00 Europe/Amsterdam = 09:00 UTC
    const utc = wallTimeToUtc(2026, 1, 15, 10, 0, TZ);
    expect(utc.toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });

  it("maps Amsterdam summer time to UTC (+2)", () => {
    // 2026-07-15 10:00 Europe/Amsterdam = 08:00 UTC
    const utc = wallTimeToUtc(2026, 7, 15, 10, 0, TZ);
    expect(utc.toISOString()).toBe("2026-07-15T08:00:00.000Z");
  });
});

describe("computeNextRunAt", () => {
  it("once: returns start day's timeOfDay when still upcoming", () => {
    const startAt = wallTimeToUtc(2026, 3, 10, 0, 0, TZ);
    const after = wallTimeToUtc(2026, 3, 9, 12, 0, TZ);
    const next = computeNextRunAt({
      frequency: "once",
      timeOfDay: "15:00",
      timeZone: TZ,
      startAt,
      after,
    });
    expect(next?.toISOString()).toBe(
      wallTimeToUtc(2026, 3, 10, 15, 0, TZ).toISOString(),
    );
  });

  it("once: returns null after the single fire", () => {
    const startAt = wallTimeToUtc(2026, 3, 10, 0, 0, TZ);
    const after = wallTimeToUtc(2026, 3, 10, 15, 0, TZ);
    const next = computeNextRunAt({
      frequency: "once",
      timeOfDay: "15:00",
      timeZone: TZ,
      startAt,
      after,
    });
    expect(next).toBeNull();
  });

  it("daily: picks the next local timeOfDay after `after`", () => {
    const startAt = wallTimeToUtc(2026, 3, 1, 0, 0, TZ);
    const after = wallTimeToUtc(2026, 3, 10, 10, 0, TZ);
    const next = computeNextRunAt({
      frequency: "daily",
      timeOfDay: "09:00",
      timeZone: TZ,
      startAt,
      after,
    });
    expect(next?.toISOString()).toBe(
      wallTimeToUtc(2026, 3, 11, 9, 0, TZ).toISOString(),
    );
  });

  it("weekly: lands on the requested weekday", () => {
    // 2026-03-10 is Tuesday; weekday 0 = Sunday
    const startAt = wallTimeToUtc(2026, 3, 10, 0, 0, TZ);
    const after = wallTimeToUtc(2026, 3, 10, 8, 0, TZ);
    const next = computeNextRunAt({
      frequency: "weekly",
      timeOfDay: "09:00",
      timeZone: TZ,
      byWeekday: 0,
      startAt,
      after,
    });
    expect(next?.toISOString()).toBe(
      wallTimeToUtc(2026, 3, 15, 9, 0, TZ).toISOString(),
    );
  });

  it("monthly: clamps day 31 into shorter months", () => {
    const startAt = wallTimeToUtc(2026, 1, 1, 0, 0, TZ);
    // after Jan 31 fire
    const after = wallTimeToUtc(2026, 1, 31, 10, 0, TZ);
    const next = computeNextRunAt({
      frequency: "monthly",
      timeOfDay: "10:00",
      timeZone: TZ,
      byMonthDay: 31,
      startAt,
      after,
    });
    // February 2026 has 28 days → 28th
    expect(next?.toISOString()).toBe(
      wallTimeToUtc(2026, 2, 28, 10, 0, TZ).toISOString(),
    );
  });

  it("respects endAt and returns null when past the window", () => {
    const startAt = wallTimeToUtc(2026, 3, 1, 0, 0, TZ);
    const endAt = wallTimeToUtc(2026, 3, 5, 23, 59, TZ);
    const after = wallTimeToUtc(2026, 3, 5, 10, 0, TZ);
    const next = computeNextRunAt({
      frequency: "daily",
      timeOfDay: "09:00",
      timeZone: TZ,
      startAt,
      endAt,
      after,
    });
    expect(next).toBeNull();
  });

  it("does not schedule before startAt", () => {
    const startAt = wallTimeToUtc(2026, 4, 1, 0, 0, TZ);
    const after = new Date(0);
    const next = computeNextRunAt({
      frequency: "daily",
      timeOfDay: "08:00",
      timeZone: TZ,
      startAt,
      after,
    });
    expect(next?.toISOString()).toBe(
      wallTimeToUtc(2026, 4, 1, 8, 0, TZ).toISOString(),
    );
  });
});
