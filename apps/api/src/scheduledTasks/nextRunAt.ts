export type ScheduledTaskFrequency = "once" | "daily" | "weekly" | "monthly";

export type ComputeNextRunInput = {
  frequency: ScheduledTaskFrequency;
  /** Local wall-clock "HH:mm" (24h). */
  timeOfDay: string;
  /** IANA timezone, e.g. Europe/Amsterdam. */
  timeZone: string;
  /** weekly: 0=Sunday … 6=Saturday. */
  byWeekday?: number | null;
  /** monthly: 1–31 (clamped to month length). */
  byMonthDay?: number | null;
  startAt: Date;
  endAt?: Date | null;
  /**
   * Exclusive lower bound. Use last run time, or `new Date(0)` when computing
   * the first `nextRunAt` for a new task.
   */
  after: Date;
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0=Sun … 6=Sat
};

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function parseTimeOfDay(timeOfDay: string): { hour: number; minute: number } {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeOfDay.trim());
  if (!m) {
    throw new Error(`Invalid timeOfDay "${timeOfDay}" (expected HH:mm)`);
  }
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const map = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const weekday = WEEKDAY_MAP[map.weekday ?? ""];
  if (weekday === undefined) {
    throw new Error(`Could not resolve weekday for ${date.toISOString()} in ${timeZone}`);
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    weekday,
  };
}

/** Convert a wall-clock datetime in `timeZone` to a UTC Date. */
export function wallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i++) {
    const parts = zonedParts(new Date(utcMs), timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      0,
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
    const delta = desired - asUtc;
    if (delta === 0) break;
    utcMs += delta;
  }
  return new Date(utcMs);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addDays(year: number, month: number, day: number, delta: number) {
  const dt = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  };
}

function candidateOnDay(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  return wallTimeToUtc(year, month, day, hour, minute, timeZone);
}

/**
 * Next fire time strictly after `after`, on/after `startAt`, and not after `endAt`.
 * Returns `null` when no further occurrence exists.
 */
export function computeNextRunAt(input: ComputeNextRunInput): Date | null {
  const { hour, minute } = parseTimeOfDay(input.timeOfDay);
  const timeZone = input.timeZone || "Europe/Amsterdam";
  const startMs = input.startAt.getTime();
  const afterMs = input.after.getTime();
  const endMs = input.endAt?.getTime() ?? Number.POSITIVE_INFINITY;

  const lowerBound = new Date(Math.max(startMs, afterMs + 1));
  const cursorParts = zonedParts(lowerBound, timeZone);

  const matches = (y: number, m: number, d: number): boolean => {
    const at = candidateOnDay(y, m, d, hour, minute, timeZone);
    if (at.getTime() <= afterMs) return false;
    if (at.getTime() < startMs) return false;
    if (at.getTime() > endMs) return false;

    if (input.frequency === "once" || input.frequency === "daily") {
      return true;
    }
    if (input.frequency === "weekly") {
      const wd = input.byWeekday;
      if (wd == null || wd < 0 || wd > 6) {
        throw new Error("weekly frequency requires byWeekday 0–6");
      }
      return zonedParts(at, timeZone).weekday === wd;
    }
    if (input.frequency === "monthly") {
      const md = input.byMonthDay;
      if (md == null || md < 1 || md > 31) {
        throw new Error("monthly frequency requires byMonthDay 1–31");
      }
      const dim = daysInMonth(y, m);
      const targetDay = Math.min(md, dim);
      return d === targetDay;
    }
    return false;
  };

  // once: only the first matching slot on/after startAt's local calendar day
  if (input.frequency === "once") {
    const startParts = zonedParts(input.startAt, timeZone);
    const at = candidateOnDay(
      startParts.year,
      startParts.month,
      startParts.day,
      hour,
      minute,
      timeZone,
    );
    // If time-of-day on start day is already <= after or < startAt instant, no run.
    if (at.getTime() <= afterMs || at.getTime() < startMs || at.getTime() > endMs) {
      return null;
    }
    return at;
  }

  let y = cursorParts.year;
  let m = cursorParts.month;
  let d = cursorParts.day;

  // Walk up to ~14 months of days
  for (let i = 0; i < 450; i++) {
    if (matches(y, m, d)) {
      return candidateOnDay(y, m, d, hour, minute, timeZone);
    }
    ({ year: y, month: m, day: d } = addDays(y, m, d, 1));
    // Bail early if calendar day is past endAt
    const dayStart = candidateOnDay(y, m, d, 0, 0, timeZone);
    if (dayStart.getTime() > endMs) return null;
  }

  return null;
}
