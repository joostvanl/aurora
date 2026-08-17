import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyTasks = vi.fn();
const findFirstTask = vi.fn();
const findManyRuns = vi.fn();

vi.mock("../db.js", () => ({
  prisma: {
    scheduledTask: {
      findMany: (...args: unknown[]) => findManyTasks(...args),
      findFirst: (...args: unknown[]) => findFirstTask(...args),
    },
    scheduledTaskRun: {
      findMany: (...args: unknown[]) => findManyRuns(...args),
    },
  },
}));

vi.mock("./webFetch.js", () => ({
  fetchPublicUrl: vi.fn(),
  WebFetchError: class WebFetchError extends Error {},
}));

import {
  aiToolsForSource,
  executeAiTool,
  SCHEDULED_TASK_INSPECT_TOOLS,
} from "./tools.js";

const adminCtx = {
  websiteId: "ws1",
  role: "admin" as const,
};

describe("scheduled task inspect tools — toolset", () => {
  it("exposes inspect tools to chat builders", () => {
    const names = aiToolsForSource("chat", { role: "builder" }).map(
      (t) => t.function.name,
    );
    expect(names).toContain("list_scheduled_tasks");
    expect(names).toContain("get_scheduled_task");
    expect(names).toContain("list_scheduled_task_runs");
  });

  it("omits inspect tools from scheduled_task source", () => {
    const names = aiToolsForSource("scheduled_task", { role: "admin" }).map(
      (t) => t.function.name,
    );
    expect(names).not.toContain("list_scheduled_tasks");
    expect(names).not.toContain("get_scheduled_task");
    expect(names).not.toContain("list_scheduled_task_runs");
  });

  it("omits inspect tools for editors", () => {
    const names = aiToolsForSource("chat", { role: "editor" }).map(
      (t) => t.function.name,
    );
    expect(names).not.toContain("list_scheduled_tasks");
    expect(names).not.toContain("get_scheduled_task");
  });

  it("lists inspect tool names", () => {
    expect(SCHEDULED_TASK_INSPECT_TOOLS.has("list_scheduled_tasks")).toBe(true);
    expect(SCHEDULED_TASK_INSPECT_TOOLS.has("get_scheduled_task")).toBe(true);
    expect(SCHEDULED_TASK_INSPECT_TOOLS.has("list_scheduled_task_runs")).toBe(
      true,
    );
  });
});

describe("scheduled task inspect tools — execute", () => {
  beforeEach(() => {
    findManyTasks.mockReset();
    findFirstTask.mockReset();
    findManyRuns.mockReset();
  });

  it("denies editors at execute time", async () => {
    const result = await executeAiTool("list_scheduled_tasks", {}, {
      websiteId: "ws1",
      role: "editor",
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/Permission denied/);
    expect(findManyTasks).not.toHaveBeenCalled();
  });

  it("lists tasks with prompt preview", async () => {
    findManyTasks.mockResolvedValue([
      {
        id: "t1",
        name: "Daily digest",
        enabled: true,
        frequency: "daily",
        timeOfDay: "07:00",
        timeZone: "Europe/Amsterdam",
        nextRunAt: new Date("2026-08-18T05:00:00.000Z"),
        lastRunAt: new Date("2026-08-17T05:00:00.000Z"),
        lastStatus: "ok",
        allowPublish: false,
        prompt: "Write a short digest about site news.",
      },
    ]);

    const result = await executeAiTool("list_scheduled_tasks", {}, adminCtx);
    expect(result.ok).toBe(true);
    expect(result.summary).toMatch(/1 scheduled task/);
    const rows = result.data as Array<{ name: string; promptPreview: string }>;
    expect(rows[0].name).toBe("Daily digest");
    expect(rows[0].promptPreview).toContain("digest");
  });

  it("returns not-ok when get_scheduled_task misses", async () => {
    findFirstTask.mockResolvedValue(null);
    const result = await executeAiTool(
      "get_scheduled_task",
      { name: "Missing" },
      adminCtx,
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/not found/);
  });

  it("loads a task with recent runs", async () => {
    const startedAt = new Date("2026-08-17T05:00:00.000Z");
    findFirstTask.mockResolvedValue({
      id: "t1",
      websiteId: "ws1",
      name: "Daily digest",
      prompt: "Do the digest",
      macroId: null,
      enabled: true,
      allowPublish: false,
      maxTokens: null,
      maxToolCalls: null,
      frequency: "daily",
      timeOfDay: "07:00",
      timeZone: "Europe/Amsterdam",
      byWeekday: null,
      byMonthDay: null,
      startAt: startedAt,
      endAt: null,
      nextRunAt: null,
      lastRunAt: startedAt,
      lastStatus: "ok",
      lastError: null,
      createdByUserId: null,
      createdAt: startedAt,
      updatedAt: startedAt,
      runs: [
        {
          id: "r1",
          taskId: "t1",
          startedAt,
          finishedAt: startedAt,
          ok: true,
          summary: "Agent finished",
          reply: "## Done\n- Posted digest",
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          toolCallCount: 2,
          uniqueToolCount: 2,
          stoppedReason: "completed",
          createdAt: startedAt,
        },
      ],
    });

    const result = await executeAiTool(
      "get_scheduled_task",
      { name: "Daily digest" },
      adminCtx,
    );
    expect(result.ok).toBe(true);
    const data = result.data as {
      name: string;
      recentRuns?: Array<{ reply: string | null; ok: boolean }>;
    };
    expect(data.name).toBe("Daily digest");
    expect(data.recentRuns?.[0].ok).toBe(true);
    expect(data.recentRuns?.[0].reply).toContain("Posted digest");
  });

  it("lists runs for a task by name", async () => {
    findFirstTask.mockResolvedValue({ id: "t1", name: "Daily digest" });
    const startedAt = new Date("2026-08-17T05:00:00.000Z");
    findManyRuns.mockResolvedValue([
      {
        id: "r1",
        taskId: "t1",
        startedAt,
        finishedAt: startedAt,
        ok: false,
        summary: "Timed out",
        reply: null,
        promptTokens: 1,
        completionTokens: 0,
        totalTokens: 1,
        toolCallCount: 0,
        uniqueToolCount: 0,
        stoppedReason: "timeout",
        createdAt: startedAt,
      },
    ]);

    const result = await executeAiTool(
      "list_scheduled_task_runs",
      { taskName: "Daily digest", limit: 5 },
      adminCtx,
    );
    expect(result.ok).toBe(true);
    const data = result.data as {
      taskName: string;
      runs: Array<{ ok: boolean; summary: string | null }>;
    };
    expect(data.taskName).toBe("Daily digest");
    expect(data.runs[0].ok).toBe(false);
    expect(data.runs[0].summary).toBe("Timed out");
  });

  it("blocks inspect tools when source is scheduled_task", async () => {
    const result = await executeAiTool("list_scheduled_tasks", {}, {
      ...adminCtx,
      source: "scheduled_task",
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/self-inspection/);
    expect(findManyTasks).not.toHaveBeenCalled();
  });
});
