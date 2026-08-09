import type { ScheduledTask } from "@prisma/client";
import { prisma } from "../db.js";
import { runAiChat } from "../ai/agent.js";
import { httpError } from "../lib/httpError.js";
import { computeNextRunAt } from "./nextRunAt.js";
import { getTaskOrThrow, scheduleFieldsFromTask } from "./service.js";

const REPLY_MAX = 4000;
const SUMMARY_MAX = 500;
const ERROR_MAX = 1000;
/** Soft cap for unattended agent runs (Promise.race; work may continue in background). */
const RUN_TIMEOUT_MS = Number(process.env.CMS_SCHEDULED_TASK_TIMEOUT_MS ?? 180_000);

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Scheduled task timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function resolveScheduledTaskActorUserId(
  task: Pick<ScheduledTask, "websiteId" | "createdByUserId">,
): Promise<string> {
  if (task.createdByUserId) return task.createdByUserId;
  const admin = await prisma.membership.findFirst({
    where: { websiteId: task.websiteId, role: "admin" },
    select: { userId: true },
    orderBy: { createdAt: "asc" },
  });
  if (admin) return admin.userId;
  const any = await prisma.membership.findFirst({
    where: { websiteId: task.websiteId },
    select: { userId: true },
    orderBy: { createdAt: "asc" },
  });
  if (any) return any.userId;
  throw httpError(
    400,
    "No website member available to attribute scheduled task run",
    "BAD_REQUEST",
  );
}

function nextScheduleAfterRun(task: ScheduledTask, after: Date) {
  if (!task.enabled) return { nextRunAt: null as Date | null, enabled: false };
  const fields = scheduleFieldsFromTask(task);
  const nextRunAt = computeNextRunAt({
    ...fields,
    after,
  });
  if (task.frequency === "once" || nextRunAt == null) {
    return { nextRunAt: null, enabled: false };
  }
  return { nextRunAt, enabled: true };
}

/**
 * Execute a scheduled task via the full AI agent path (`mode: general`).
 * Advances `nextRunAt` / disables when once or past endAt.
 */
export async function runScheduledTask(input: {
  websiteId: string;
  taskId: string;
  /** When true, run even if nextRunAt is in the future (manual run-now). */
  force?: boolean;
  /** Injected for tests. */
  runAiChat?: typeof runAiChat;
}) {
  const task = await getTaskOrThrow(input.websiteId, input.taskId);
  if (!task.enabled && !input.force) {
    throw httpError(400, "Scheduled task is disabled", "BAD_REQUEST");
  }

  const startedAt = new Date();
  const run = await prisma.scheduledTaskRun.create({
    data: {
      taskId: task.id,
      startedAt,
      ok: false,
      summary: "Running…",
    },
  });

  const chat = input.runAiChat ?? runAiChat;
  let ok = false;
  let summary = "";
  let reply: string | null = null;
  let lastError: string | null = null;

  try {
    const userId = await resolveScheduledTaskActorUserId(task);
    const website = await prisma.website.findUnique({
      where: { id: task.websiteId },
      select: { name: true },
    });
    const result = await withTimeout(
      chat({
        message: task.prompt,
        websiteId: task.websiteId,
        userId,
        role: "admin",
        source: "scheduled_task",
        allowPublish: task.allowPublish,
        context: {
          mode: "general",
          websiteName: website?.name,
        },
      }),
      RUN_TIMEOUT_MS,
    );
    ok = true;
    reply = truncate(result.reply ?? "", REPLY_MAX) || null;
    const toolOk = result.toolCalls.filter((t) => t.ok).length;
    const toolFail = result.toolCalls.filter((t) => !t.ok).length;
    summary = truncate(
      toolOk || toolFail
        ? `Agent finished (${toolOk} tool ok, ${toolFail} failed). ${result.reply ?? ""}`.trim()
        : (result.reply ?? "Agent finished.").trim(),
      SUMMARY_MAX,
    );
  } catch (err) {
    ok = false;
    const message = err instanceof Error ? err.message : String(err);
    lastError = truncate(message, ERROR_MAX);
    summary = truncate(message, SUMMARY_MAX);
  }

  const finishedAt = new Date();
  const schedule = nextScheduleAfterRun(task, startedAt);

  const [updatedRun, updatedTask] = await prisma.$transaction([
    prisma.scheduledTaskRun.update({
      where: { id: run.id },
      data: {
        finishedAt,
        ok,
        summary,
        reply,
      },
    }),
    prisma.scheduledTask.update({
      where: { id: task.id },
      data: {
        lastRunAt: startedAt,
        lastStatus: ok ? "ok" : "error",
        lastError,
        nextRunAt: schedule.nextRunAt,
        enabled: schedule.enabled,
      },
    }),
  ]);

  return { run: updatedRun, task: updatedTask };
}
