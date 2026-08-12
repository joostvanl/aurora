import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_TIMEZONE,
  formatCurrentDateTimePromptBlock,
  getCurrentDateTime,
  resolveAgentTimeZone,
} from "./currentTime.js";

describe("currentTime", () => {
  // Fixed instant: 2026-08-12T07:30:00.000Z = 09:30 in Europe/Amsterdam (CEST, UTC+2)
  const fixed = new Date("2026-08-12T07:30:00.000Z");

  it("defaults to Europe/Amsterdam", () => {
    expect(resolveAgentTimeZone({})).toBe(DEFAULT_AGENT_TIMEZONE);
  });

  it("honors CMS_AGENT_TIMEZONE when valid", () => {
    expect(resolveAgentTimeZone({ CMS_AGENT_TIMEZONE: "UTC" })).toBe("UTC");
    expect(
      resolveAgentTimeZone({ CMS_AGENT_TIMEZONE: "America/New_York" }),
    ).toBe("America/New_York");
  });

  it("falls back on invalid CMS_AGENT_TIMEZONE", () => {
    expect(
      resolveAgentTimeZone({ CMS_AGENT_TIMEZONE: "Not/A_Zone" }),
    ).toBe(DEFAULT_AGENT_TIMEZONE);
  });

  it("formats a fixed clock in Europe/Amsterdam", () => {
    const info = getCurrentDateTime(fixed, {});
    expect(info.timeZone).toBe("Europe/Amsterdam");
    expect(info.utcIso).toBe("2026-08-12T07:30:00.000Z");
    expect(info.date).toBe("2026-08-12");
    expect(info.time).toBe("09:30:00");
    expect(info.localIso).toBe("2026-08-12T09:30:00");
    expect(info.weekday).toBe("Wednesday");
    expect(info.localDisplay).toContain("12 August 2026");
    expect(info.localDisplay).toContain("09:30:00");
  });

  it("formats UTC when CMS_AGENT_TIMEZONE=UTC", () => {
    const info = getCurrentDateTime(fixed, { CMS_AGENT_TIMEZONE: "UTC" });
    expect(info.timeZone).toBe("UTC");
    expect(info.date).toBe("2026-08-12");
    expect(info.time).toBe("07:30:00");
    expect(info.localIso).toBe("2026-08-12T07:30:00");
  });

  it("builds a prompt block with ground-truth clock", () => {
    const info = getCurrentDateTime(fixed, {});
    const block = formatCurrentDateTimePromptBlock(info);
    expect(block).toContain("authoritative server clock");
    expect(block).toContain(info.utcIso);
    expect(block).toContain(info.localDisplay);
    expect(block).toContain("get_current_datetime");
  });
});
