import { describe, expect, it } from "vitest";
import {
  CreateScheduledTaskSchema,
  UpdateScheduledTaskSchema,
} from "@cms/shared";

describe("CreateScheduledTaskSchema", () => {
  const base = {
    name: "Sunday digest",
    prompt: "Find interesting news…",
    frequency: "weekly" as const,
    timeOfDay: "09:00",
    byWeekday: 0,
    startAt: "2026-03-01T00:00:00.000Z",
  };

  it("accepts a weekly task with prompt", () => {
    const parsed = CreateScheduledTaskSchema.parse(base);
    expect(parsed.enabled).toBe(true);
    expect(parsed.allowPublish).toBe(false);
    expect(parsed.timeZone).toBe("Europe/Amsterdam");
  });

  it("accepts allowPublish true", () => {
    const parsed = CreateScheduledTaskSchema.parse({
      ...base,
      allowPublish: true,
    });
    expect(parsed.allowPublish).toBe(true);
  });

  it("rejects weekly without byWeekday", () => {
    expect(() =>
      CreateScheduledTaskSchema.parse({ ...base, byWeekday: undefined }),
    ).toThrow(/byWeekday/);
  });

  it("rejects missing prompt and macroId", () => {
    expect(() =>
      CreateScheduledTaskSchema.parse({
        name: base.name,
        frequency: "daily",
        timeOfDay: "09:00",
        startAt: base.startAt,
      }),
    ).toThrow(/prompt/);
  });

  it("rejects invalid timeOfDay", () => {
    expect(() =>
      CreateScheduledTaskSchema.parse({ ...base, timeOfDay: "9:00" }),
    ).toThrow(/HH:mm/);
  });
});

describe("UpdateScheduledTaskSchema", () => {
  it("allows partial updates", () => {
    const parsed = UpdateScheduledTaskSchema.parse({ enabled: false });
    expect(parsed.enabled).toBe(false);
  });
});
