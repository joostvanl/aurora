import type { ScheduledTask, ScheduledTaskFrequency } from "@prisma/client";
import { prisma } from "../db.js";
import { resolveAiConfig } from "../ai/config.js";
import { httpError } from "../lib/httpError.js";
import { asCreatedByUserId } from "../lib/entries.js";
import { computeNextRunAt, parseTimeOfDay } from "./nextRunAt.js";

export type TaskScheduleFields = {
  frequency: ScheduledTaskFrequency;
  timeOfDay: string;
  timeZone: string;
  byWeekday: number | null;
  byMonthDay: number | null;
  startAt: Date;
  endAt: Date | null;
};

export function assertScheduleFields(fields: TaskScheduleFields) {
  parseTimeOfDay(fields.timeOfDay);
  if (fields.frequency === "weekly") {
    if (fields.byWeekday == null || fields.byWeekday < 0 || fields.byWeekday > 6) {
      throw httpError(
        400,
        "weekly frequency requires byWeekday 0–6",
        "VALIDATION_FAILED",
      );
    }
  }
  if (fields.frequency === "monthly") {
    if (
      fields.byMonthDay == null ||
      fields.byMonthDay < 1 ||
      fields.byMonthDay > 31
    ) {
      throw httpError(
        400,
        "monthly frequency requires byMonthDay 1–31",
        "VALIDATION_FAILED",
      );
    }
  }
  if (fields.endAt && fields.endAt.getTime() < fields.startAt.getTime()) {
    throw httpError(400, "endAt must be on or after startAt", "VALIDATION_FAILED");
  }
}

export function computeInitialNextRunAt(fields: TaskScheduleFields): Date | null {
  assertScheduleFields(fields);
  return computeNextRunAt({
    frequency: fields.frequency,
    timeOfDay: fields.timeOfDay,
    timeZone: fields.timeZone,
    byWeekday: fields.byWeekday,
    byMonthDay: fields.byMonthDay,
    startAt: fields.startAt,
    endAt: fields.endAt,
    after: new Date(0),
  });
}

export async function resolveTaskPrompt(input: {
  websiteId: string;
  prompt?: string | null;
  macroId?: string | null;
  existingPrompt?: string;
}): Promise<{ prompt: string; macroId: string | null }> {
  let prompt = input.prompt?.trim() || "";
  let macroId = input.macroId?.trim() || null;

  if (macroId) {
    const config = await resolveAiConfig(input.websiteId);
    const macro = config.macros.find((m) => m.id === macroId);
    if (!macro) {
      throw httpError(404, `Macro "${macroId}" not found`, "NOT_FOUND");
    }
    // Prefill from macro when prompt omitted; keep explicit prompt if provided.
    if (!prompt) prompt = macro.prompt;
  }

  if (!prompt) {
    prompt = input.existingPrompt?.trim() || "";
  }

  if (!prompt) {
    throw httpError(
      400,
      "Prompt is required (provide prompt or a valid macroId)",
      "VALIDATION_FAILED",
    );
  }

  return { prompt, macroId };
}

export async function getTaskOrThrow(websiteId: string, id: string) {
  const task = await prisma.scheduledTask.findFirst({
    where: { id, websiteId },
  });
  if (!task) throw httpError(404, "Scheduled task not found", "NOT_FOUND");
  return task;
}

export function scheduleFieldsFromTask(task: ScheduledTask): TaskScheduleFields {
  return {
    frequency: task.frequency,
    timeOfDay: task.timeOfDay,
    timeZone: task.timeZone,
    byWeekday: task.byWeekday,
    byMonthDay: task.byMonthDay,
    startAt: task.startAt,
    endAt: task.endAt,
  };
}

export async function createScheduledTask(input: {
  websiteId: string;
  userId: string | null | undefined;
  name: string;
  prompt?: string;
  macroId?: string;
  enabled: boolean;
  allowPublish?: boolean;
  frequency: ScheduledTaskFrequency;
  timeOfDay: string;
  timeZone: string;
  byWeekday?: number | null;
  byMonthDay?: number | null;
  startAt: Date;
  endAt?: Date | null;
}) {
  const { prompt, macroId } = await resolveTaskPrompt({
    websiteId: input.websiteId,
    prompt: input.prompt,
    macroId: input.macroId,
  });

  const fields: TaskScheduleFields = {
    frequency: input.frequency,
    timeOfDay: input.timeOfDay,
    timeZone: input.timeZone,
    byWeekday: input.byWeekday ?? null,
    byMonthDay: input.byMonthDay ?? null,
    startAt: input.startAt,
    endAt: input.endAt ?? null,
  };
  const nextRunAt = input.enabled ? computeInitialNextRunAt(fields) : null;

  return prisma.scheduledTask.create({
    data: {
      websiteId: input.websiteId,
      name: input.name,
      prompt,
      macroId,
      enabled: input.enabled,
      allowPublish: input.allowPublish ?? false,
      frequency: fields.frequency,
      timeOfDay: fields.timeOfDay,
      timeZone: fields.timeZone,
      byWeekday: fields.byWeekday,
      byMonthDay: fields.byMonthDay,
      startAt: fields.startAt,
      endAt: fields.endAt,
      nextRunAt,
      createdByUserId: asCreatedByUserId(input.userId),
    },
  });
}
