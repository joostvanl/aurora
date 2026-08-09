import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({
  prisma: {
    scheduledTask: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "../db.js";
import {
  _resetPollerStateForTests,
  claimDueTask,
  isScheduledTasksPollerEnabled,
  pollDueScheduledTasks,
} from "./poller.js";

const findMany = prisma.scheduledTask.findMany as ReturnType<typeof vi.fn>;
const updateMany = prisma.scheduledTask.updateMany as ReturnType<typeof vi.fn>;

describe("scheduled task poller", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPollerStateForTests();
  });

  it("is enabled by default and disabled when CMS_SCHEDULED_TASKS=0", () => {
    expect(isScheduledTasksPollerEnabled({})).toBe(true);
    expect(isScheduledTasksPollerEnabled({ CMS_SCHEDULED_TASKS: "0" })).toBe(
      false,
    );
  });

  it("claims only when nextRunAt still matches", async () => {
    updateMany.mockResolvedValue({ count: 1 });
    const nextRunAt = new Date("2026-08-01T08:00:00.000Z");
    await expect(claimDueTask({ id: "t1", nextRunAt })).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "t1", enabled: true, nextRunAt },
      }),
    );

    updateMany.mockResolvedValue({ count: 0 });
    await expect(claimDueTask({ id: "t1", nextRunAt })).resolves.toBe(false);
  });

  it("runs claimed due tasks and skips busy websites", async () => {
    const nextRunAt = new Date("2026-08-01T08:00:00.000Z");
    findMany.mockResolvedValue([
      {
        id: "t1",
        websiteId: "w1",
        enabled: true,
        nextRunAt,
      },
      {
        id: "t2",
        websiteId: "w1",
        enabled: true,
        nextRunAt,
      },
    ]);
    updateMany.mockResolvedValue({ count: 1 });
    const run = vi.fn().mockResolvedValue({
      run: {},
      task: {},
    });

    const started = await pollDueScheduledTasks({
      now: () => new Date("2026-08-01T08:01:00.000Z"),
      runScheduledTask: run,
    });

    expect(started).toBe(1);
    // Allow async fire-and-forget to settle
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run).toHaveBeenCalledWith({ websiteId: "w1", taskId: "t1" });
  });
});
