import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({
  prisma: {
    scheduledTask: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    scheduledTaskRun: {
      create: vi.fn(),
      update: vi.fn(),
    },
    membership: {
      findFirst: vi.fn(),
    },
    website: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../db.js";
import { runScheduledTask } from "./runScheduledTask.js";

const findFirst = prisma.scheduledTask.findFirst as ReturnType<typeof vi.fn>;
const runCreate = prisma.scheduledTaskRun.create as ReturnType<typeof vi.fn>;
const runUpdate = prisma.scheduledTaskRun.update as ReturnType<typeof vi.fn>;
const taskUpdate = prisma.scheduledTask.update as ReturnType<typeof vi.fn>;
const membershipFindFirst = prisma.membership.findFirst as ReturnType<
  typeof vi.fn
>;
const websiteFindUnique = prisma.website.findUnique as ReturnType<typeof vi.fn>;
const transaction = prisma.$transaction as ReturnType<typeof vi.fn>;

function baseTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task1",
    websiteId: "ws1",
    name: "Daily draft",
    prompt: "Create a draft news item",
    macroId: null,
    enabled: true,
    allowPublish: false,
    maxTokens: null,
    maxToolCalls: null,
    frequency: "daily",
    timeOfDay: "08:00",
    timeZone: "Europe/Amsterdam",
    byWeekday: null,
    byMonthDay: null,
    startAt: new Date("2026-01-01T00:00:00.000Z"),
    endAt: null,
    nextRunAt: new Date("2026-08-01T06:00:00.000Z"),
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    createdByUserId: "user1",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("runScheduledTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue(baseTask());
    runCreate.mockResolvedValue({
      id: "run1",
      taskId: "task1",
      startedAt: new Date(),
      ok: false,
    });
    websiteFindUnique.mockResolvedValue({ name: "Demo" });
    runUpdate.mockImplementation(async ({ data }: { data: unknown }) => ({
      id: "run1",
      ...(data as object),
    }));
    taskUpdate.mockImplementation(async ({ data }: { data: unknown }) => ({
      ...baseTask(),
      ...(data as object),
    }));
    transaction.mockImplementation(async (ops: Promise<unknown>[]) =>
      Promise.all(ops),
    );
  });

  it("calls agent with scheduled_task source and advances nextRunAt", async () => {
    const chat = vi.fn().mockResolvedValue({
      reply: "Created draft entry.",
      toolCalls: [{ name: "create_entry", ok: true, summary: "ok" }],
      model: "test",
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        toolCallCount: 1,
        uniqueToolCount: 1,
      },
      stoppedReason: "completed",
    });

    const { run, task } = await runScheduledTask({
      websiteId: "ws1",
      taskId: "task1",
      runAiChat: chat,
    });

    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Create a draft news item",
        websiteId: "ws1",
        userId: "user1",
        role: "admin",
        source: "scheduled_task",
        allowPublish: false,
        maxTokens: null,
        maxToolCalls: null,
        scheduledTaskId: "task1",
        scheduledTaskRunId: "run1",
        context: expect.objectContaining({ mode: "general" }),
      }),
    );
    expect(run.ok).toBe(true);
    expect(run.totalTokens).toBe(30);
    expect(run.toolCallCount).toBe(1);
    expect(run.stoppedReason).toBe("completed");
    expect(task.lastStatus).toBe("ok");
    expect(task.nextRunAt).toBeInstanceOf(Date);
    expect(task.enabled).toBe(true);
  });

  it("passes caps to the agent and persists max_tool_calls stop", async () => {
    findFirst.mockResolvedValue(
      baseTask({ maxTokens: 1000, maxToolCalls: 2 }),
    );
    const chat = vi.fn().mockResolvedValue({
      reply: "Stopped early",
      toolCalls: [
        { name: "list_entries", ok: true, summary: "ok" },
        { name: "create_entry", ok: true, summary: "ok" },
      ],
      model: "test",
      usage: {
        promptTokens: 40,
        completionTokens: 60,
        totalTokens: 100,
        toolCallCount: 2,
        uniqueToolCount: 2,
      },
      stoppedReason: "max_tool_calls",
    });

    const { run } = await runScheduledTask({
      websiteId: "ws1",
      taskId: "task1",
      runAiChat: chat,
    });

    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 1000,
        maxToolCalls: 2,
      }),
    );
    expect(run.stoppedReason).toBe("max_tool_calls");
    expect(run.totalTokens).toBe(100);
    expect(run.uniqueToolCount).toBe(2);
  });

  it("disables once-tasks and clears nextRunAt", async () => {
    findFirst.mockResolvedValue(baseTask({ frequency: "once" }));
    const chat = vi.fn().mockResolvedValue({
      reply: "Done",
      toolCalls: [],
      model: "test",
    });

    const { task } = await runScheduledTask({
      websiteId: "ws1",
      taskId: "task1",
      runAiChat: chat,
    });

    expect(task.enabled).toBe(false);
    expect(task.nextRunAt).toBeNull();
  });

  it("records error status when agent throws", async () => {
    const chat = vi.fn().mockRejectedValue(new Error("AI not configured"));

    const { run, task } = await runScheduledTask({
      websiteId: "ws1",
      taskId: "task1",
      runAiChat: chat,
    });

    expect(run.ok).toBe(false);
    expect(task.lastStatus).toBe("error");
    expect(task.lastError).toMatch(/AI not configured/);
    expect(task.nextRunAt).toBeInstanceOf(Date);
  });

  it("passes allowPublish true to the agent when enabled on the task", async () => {
    findFirst.mockResolvedValue(baseTask({ allowPublish: true }));
    const chat = vi.fn().mockResolvedValue({
      reply: "Published",
      toolCalls: [],
      model: "test",
    });

    await runScheduledTask({
      websiteId: "ws1",
      taskId: "task1",
      runAiChat: chat,
    });

    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "scheduled_task",
        allowPublish: true,
      }),
    );
  });

  it("resolves actor from website admin when createdBy is null", async () => {
    findFirst.mockResolvedValue(baseTask({ createdByUserId: null }));
    membershipFindFirst.mockResolvedValue({ userId: "admin1" });
    const chat = vi.fn().mockResolvedValue({
      reply: "ok",
      toolCalls: [],
      model: "test",
    });

    await runScheduledTask({
      websiteId: "ws1",
      taskId: "task1",
      runAiChat: chat,
    });

    expect(membershipFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { websiteId: "ws1", role: "admin" },
      }),
    );
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "admin1" }),
    );
  });
});
