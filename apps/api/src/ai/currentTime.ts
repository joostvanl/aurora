/** Authoritative clock helpers for the AI agent (system prompt + tool). */

export const DEFAULT_AGENT_TIMEZONE = "Europe/Amsterdam";

export type CurrentDateTimeInfo = {
  utcIso: string;
  /** Local wall-clock ISO-like without offset, e.g. 2026-08-12T09:47:20 */
  localIso: string;
  /** Human-readable local stamp for copy, e.g. Tuesday, 12 August 2026, 09:47:20 */
  localDisplay: string;
  timeZone: string;
  weekday: string;
  /** Local calendar date YYYY-MM-DD */
  date: string;
  /** Local time HH:mm:ss (24h) */
  time: string;
};

export function resolveAgentTimeZone(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = env.CMS_AGENT_TIMEZONE?.trim();
  const candidate = raw || DEFAULT_AGENT_TIMEZONE;
  try {
    // Throws RangeError for invalid IANA ids.
    Intl.DateTimeFormat(undefined, { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_AGENT_TIMEZONE;
  }
}

function zonedParts(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  return map;
}

export function getCurrentDateTime(
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env,
): CurrentDateTimeInfo {
  const timeZone = resolveAgentTimeZone(env);
  const parts = zonedParts(now, timeZone);
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}:${parts.second}`;
  const localIso = `${date}T${time}`;
  const localDisplay = `${parts.weekday}, ${parts.day} ${monthName(parts.month)} ${parts.year}, ${time}`;
  return {
    utcIso: now.toISOString(),
    localIso,
    localDisplay,
    timeZone,
    weekday: parts.weekday,
    date,
    time,
  };
}

function monthName(mm: string): string {
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const idx = Number(mm) - 1;
  return names[idx] ?? mm;
}

/** Short block injected into the agent system prompt. */
export function formatCurrentDateTimePromptBlock(
  info: CurrentDateTimeInfo = getCurrentDateTime(),
): string {
  return `Current date/time (authoritative server clock — do not invent dates):
- UTC: ${info.utcIso}
- Local (${info.timeZone}): ${info.localDisplay}
- Local date: ${info.date}
Use this for "today", "now", "tomorrow", and relative dates. Call get_current_datetime if you need a refreshed clock mid-conversation.`;
}
