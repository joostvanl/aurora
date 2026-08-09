import { z } from "zod";

export const ScheduledTaskFrequencySchema = z.enum([
  "once",
  "daily",
  "weekly",
  "monthly",
]);

export type ScheduledTaskFrequency = z.infer<
  typeof ScheduledTaskFrequencySchema
>;

const TimeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "timeOfDay must be HH:mm");

const IsoDateTimeSchema = z.string().datetime({ offset: true }).or(
  z.string().datetime(),
);

export const CreateScheduledTaskSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(8000).optional(),
    macroId: z.string().trim().min(1).max(64).optional(),
    enabled: z.boolean().optional().default(true),
    /** When true, scheduled agent may publish (admin opt-in; default draft-only). */
    allowPublish: z.boolean().optional().default(false),
    frequency: ScheduledTaskFrequencySchema,
    timeOfDay: TimeOfDaySchema,
    timeZone: z.string().trim().min(1).max(64).default("Europe/Amsterdam"),
    byWeekday: z.number().int().min(0).max(6).nullable().optional(),
    byMonthDay: z.number().int().min(1).max(31).nullable().optional(),
    startAt: IsoDateTimeSchema,
    endAt: IsoDateTimeSchema.nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.prompt && !val.macroId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide prompt and/or macroId",
        path: ["prompt"],
      });
    }
    if (val.frequency === "weekly" && (val.byWeekday == null || val.byWeekday < 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "weekly frequency requires byWeekday 0–6",
        path: ["byWeekday"],
      });
    }
    if (val.frequency === "monthly" && (val.byMonthDay == null || val.byMonthDay < 1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "monthly frequency requires byMonthDay 1–31",
        path: ["byMonthDay"],
      });
    }
  });

export type CreateScheduledTaskInput = z.input<typeof CreateScheduledTaskSchema>;

export const UpdateScheduledTaskSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    prompt: z.string().trim().min(1).max(8000).optional(),
    macroId: z.string().trim().min(1).max(64).nullable().optional(),
    enabled: z.boolean().optional(),
    allowPublish: z.boolean().optional(),
    frequency: ScheduledTaskFrequencySchema.optional(),
    timeOfDay: TimeOfDaySchema.optional(),
    timeZone: z.string().trim().min(1).max(64).optional(),
    byWeekday: z.number().int().min(0).max(6).nullable().optional(),
    byMonthDay: z.number().int().min(1).max(31).nullable().optional(),
    startAt: IsoDateTimeSchema.optional(),
    endAt: IsoDateTimeSchema.nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.frequency === "weekly" && val.byWeekday === undefined) {
      // byWeekday may already be on the row; validated in route against merged state
      return;
    }
    if (val.frequency === "weekly" && val.byWeekday == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "weekly frequency requires byWeekday 0–6",
        path: ["byWeekday"],
      });
    }
    if (val.frequency === "monthly" && val.byMonthDay == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "monthly frequency requires byMonthDay 1–31",
        path: ["byMonthDay"],
      });
    }
  });

export type UpdateScheduledTaskInput = z.infer<typeof UpdateScheduledTaskSchema>;

export const ScheduledTaskRunSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  ok: z.boolean(),
  summary: z.string().nullable(),
  reply: z.string().nullable(),
  createdAt: z.string(),
});

export type ScheduledTaskRun = z.infer<typeof ScheduledTaskRunSchema>;

export const ScheduledTaskSchema = z.object({
  id: z.string(),
  websiteId: z.string(),
  name: z.string(),
  prompt: z.string(),
  macroId: z.string().nullable(),
  enabled: z.boolean(),
  allowPublish: z.boolean(),
  frequency: ScheduledTaskFrequencySchema,
  timeOfDay: z.string(),
  timeZone: z.string(),
  byWeekday: z.number().nullable(),
  byMonthDay: z.number().nullable(),
  startAt: z.string(),
  endAt: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  lastStatus: z.string().nullable(),
  lastError: z.string().nullable(),
  createdByUserId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  recentRuns: z.array(ScheduledTaskRunSchema).optional(),
});

export type ScheduledTask = z.infer<typeof ScheduledTaskSchema>;
