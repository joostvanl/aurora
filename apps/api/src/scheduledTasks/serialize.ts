import type { ScheduledTask, ScheduledTaskRun } from "@prisma/client";

export type SerializedScheduledTaskRun = {
  id: string;
  taskId: string;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean;
  summary: string | null;
  reply: string | null;
  createdAt: string;
};

export type SerializedScheduledTask = {
  id: string;
  websiteId: string;
  name: string;
  prompt: string;
  macroId: string | null;
  enabled: boolean;
  allowPublish: boolean;
  frequency: ScheduledTask["frequency"];
  timeOfDay: string;
  timeZone: string;
  byWeekday: number | null;
  byMonthDay: number | null;
  startAt: string;
  endAt: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  recentRuns?: SerializedScheduledTaskRun[];
};

export function serializeScheduledTaskRun(
  run: ScheduledTaskRun,
): SerializedScheduledTaskRun {
  return {
    id: run.id,
    taskId: run.taskId,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    ok: run.ok,
    summary: run.summary,
    reply: run.reply,
    createdAt: run.createdAt.toISOString(),
  };
}

export function serializeScheduledTask(
  task: ScheduledTask,
  recentRuns?: ScheduledTaskRun[],
): SerializedScheduledTask {
  return {
    id: task.id,
    websiteId: task.websiteId,
    name: task.name,
    prompt: task.prompt,
    macroId: task.macroId,
    enabled: task.enabled,
    allowPublish: task.allowPublish,
    frequency: task.frequency,
    timeOfDay: task.timeOfDay,
    timeZone: task.timeZone,
    byWeekday: task.byWeekday,
    byMonthDay: task.byMonthDay,
    startAt: task.startAt.toISOString(),
    endAt: task.endAt?.toISOString() ?? null,
    nextRunAt: task.nextRunAt?.toISOString() ?? null,
    lastRunAt: task.lastRunAt?.toISOString() ?? null,
    lastStatus: task.lastStatus,
    lastError: task.lastError,
    createdByUserId: task.createdByUserId,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    ...(recentRuns
      ? { recentRuns: recentRuns.map(serializeScheduledTaskRun) }
      : {}),
  };
}
