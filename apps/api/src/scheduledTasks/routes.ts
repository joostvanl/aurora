import type { FastifyInstance } from "fastify";
import {
  CreateScheduledTaskSchema,
  UpdateScheduledTaskSchema,
} from "@cms/shared";
import {
  requireWebsite,
  userIdFrom,
  websiteIdFrom,
} from "../auth/middleware.js";
import { RolePermission } from "../auth/roles.js";
import { prisma } from "../db.js";
import { httpError } from "../lib/httpError.js";
import { runScheduledTask } from "./runScheduledTask.js";
import { serializeScheduledTask } from "./serialize.js";
import {
  computeInitialNextRunAt,
  createScheduledTask,
  getTaskOrThrow,
  resolveTaskPrompt,
  scheduleFieldsFromTask,
} from "./service.js";

function parseDateField(value: string, label: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw httpError(400, `Invalid ${label}`, "VALIDATION_FAILED");
  }
  return d;
}

export async function registerScheduledTaskRoutes(app: FastifyInstance) {
  app.register(async (tasks) => {
    // Builder+ can list/get; writes require admin via per-route preHandler.
    tasks.addHook("preHandler", requireWebsite(RolePermission.schema));

    tasks.get("/api/v1/admin/scheduled-tasks", async (request) => {
      const websiteId = websiteIdFrom(request);
      const items = await prisma.scheduledTask.findMany({
        where: { websiteId },
        orderBy: [{ nextRunAt: "asc" }, { createdAt: "desc" }],
        include: {
          runs: { orderBy: { startedAt: "desc" }, take: 5 },
        },
      });
      return {
        items: items.map((t) => serializeScheduledTask(t, t.runs)),
      };
    });

    tasks.get<{ Params: { id: string } }>(
      "/api/v1/admin/scheduled-tasks/:id",
      async (request) => {
        const websiteId = websiteIdFrom(request);
        const task = await prisma.scheduledTask.findFirst({
          where: { id: request.params.id, websiteId },
          include: {
            runs: { orderBy: { startedAt: "desc" }, take: 20 },
          },
        });
        if (!task) throw httpError(404, "Scheduled task not found", "NOT_FOUND");
        return serializeScheduledTask(task, task.runs);
      },
    );

    tasks.post(
      "/api/v1/admin/scheduled-tasks",
      { preHandler: requireWebsite(RolePermission.admin) },
      async (request) => {
        const websiteId = websiteIdFrom(request);
        const body = CreateScheduledTaskSchema.parse(request.body ?? {});
        const created = await createScheduledTask({
          websiteId,
          userId: userIdFrom(request),
          name: body.name,
          prompt: body.prompt,
          macroId: body.macroId,
          enabled: body.enabled,
          frequency: body.frequency,
          timeOfDay: body.timeOfDay,
          timeZone: body.timeZone,
          byWeekday: body.byWeekday,
          byMonthDay: body.byMonthDay,
          startAt: parseDateField(body.startAt, "startAt"),
          endAt: body.endAt ? parseDateField(body.endAt, "endAt") : null,
        });
        return serializeScheduledTask(created);
      },
    );

    tasks.patch<{ Params: { id: string } }>(
      "/api/v1/admin/scheduled-tasks/:id",
      { preHandler: requireWebsite(RolePermission.admin) },
      async (request) => {
        const websiteId = websiteIdFrom(request);
        const existing = await getTaskOrThrow(websiteId, request.params.id);
        const body = UpdateScheduledTaskSchema.parse(request.body ?? {});

        const { prompt, macroId } = await resolveTaskPrompt({
          websiteId,
          prompt: body.prompt,
          macroId:
            body.macroId === undefined ? existing.macroId : body.macroId,
          existingPrompt: existing.prompt,
        });

        const fields = scheduleFieldsFromTask(existing);
        if (body.frequency !== undefined) fields.frequency = body.frequency;
        if (body.timeOfDay !== undefined) fields.timeOfDay = body.timeOfDay;
        if (body.timeZone !== undefined) fields.timeZone = body.timeZone;
        if (body.byWeekday !== undefined) fields.byWeekday = body.byWeekday;
        if (body.byMonthDay !== undefined) fields.byMonthDay = body.byMonthDay;
        if (body.startAt !== undefined) {
          fields.startAt = parseDateField(body.startAt, "startAt");
        }
        if (body.endAt !== undefined) {
          fields.endAt = body.endAt
            ? parseDateField(body.endAt, "endAt")
            : null;
        }

        const enabled = body.enabled ?? existing.enabled;
        const nextRunAt = enabled ? computeInitialNextRunAt(fields) : null;

        const updated = await prisma.scheduledTask.update({
          where: { id: existing.id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            prompt,
            macroId,
            enabled,
            frequency: fields.frequency,
            timeOfDay: fields.timeOfDay,
            timeZone: fields.timeZone,
            byWeekday: fields.byWeekday,
            byMonthDay: fields.byMonthDay,
            startAt: fields.startAt,
            endAt: fields.endAt,
            nextRunAt,
          },
        });
        return serializeScheduledTask(updated);
      },
    );

    tasks.delete<{ Params: { id: string } }>(
      "/api/v1/admin/scheduled-tasks/:id",
      { preHandler: requireWebsite(RolePermission.admin) },
      async (request) => {
        const websiteId = websiteIdFrom(request);
        await getTaskOrThrow(websiteId, request.params.id);
        await prisma.scheduledTask.delete({
          where: { id: request.params.id },
        });
        return { ok: true as const };
      },
    );

    tasks.post<{ Params: { id: string } }>(
      "/api/v1/admin/scheduled-tasks/:id/run-now",
      { preHandler: requireWebsite(RolePermission.admin) },
      async (request) => {
        const websiteId = websiteIdFrom(request);
        const { run, task } = await runScheduledTask({
          websiteId,
          taskId: request.params.id,
          force: true,
        });
        return {
          task: serializeScheduledTask(task),
          run: {
            id: run.id,
            taskId: run.taskId,
            startedAt: run.startedAt.toISOString(),
            finishedAt: run.finishedAt?.toISOString() ?? null,
            ok: run.ok,
            summary: run.summary,
            reply: run.reply,
            createdAt: run.createdAt.toISOString(),
          },
        };
      },
    );
  });
}
