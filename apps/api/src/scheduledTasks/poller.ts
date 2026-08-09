import type { FastifyBaseLogger } from "fastify";
import type { ScheduledTask } from "@prisma/client";
import { prisma } from "../db.js";
import { runScheduledTask } from "./runScheduledTask.js";

const DEFAULT_INTERVAL_MS = 45_000;
/** Temporary nextRunAt while a claimed task is executing (optimistic lock). */
const CLAIM_HOLD_UNTIL = new Date("2099-01-01T00:00:00.000Z");

export type PollerDeps = {
  now?: () => Date;
  runScheduledTask?: typeof runScheduledTask;
  log?: Pick<FastifyBaseLogger, "info" | "warn" | "error" | "debug">;
};

/** In-flight websiteIds — max 1 concurrent scheduled run per website. */
const busyWebsites = new Set<string>();

export function isScheduledTasksPollerEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.CMS_SCHEDULED_TASKS !== "0";
}

/**
 * Optimistic claim: only one worker updates when nextRunAt still matches.
 * Holds nextRunAt in the far future until runScheduledTask sets the real next.
 */
export async function claimDueTask(
  task: Pick<ScheduledTask, "id" | "nextRunAt">,
  now: Date = new Date(),
): Promise<boolean> {
  if (!task.nextRunAt) return false;
  const result = await prisma.scheduledTask.updateMany({
    where: {
      id: task.id,
      enabled: true,
      nextRunAt: task.nextRunAt,
    },
    data: {
      nextRunAt: CLAIM_HOLD_UNTIL,
      lastStatus: "running",
      lastRunAt: now,
    },
  });
  return result.count === 1;
}

export async function findDueScheduledTasks(now: Date = new Date(), take = 20) {
  return prisma.scheduledTask.findMany({
    where: {
      enabled: true,
      nextRunAt: { lte: now },
    },
    orderBy: { nextRunAt: "asc" },
    take,
  });
}

/**
 * One poll tick: claim due tasks (skip busy websites) and execute.
 * Returns number of tasks started.
 */
export async function pollDueScheduledTasks(deps: PollerDeps = {}): Promise<number> {
  const now = (deps.now ?? (() => new Date()))();
  const run = deps.runScheduledTask ?? runScheduledTask;
  const log = deps.log;
  const due = await findDueScheduledTasks(now);
  let started = 0;

  for (const task of due) {
    if (busyWebsites.has(task.websiteId)) {
      log?.debug?.(
        { websiteId: task.websiteId, taskId: task.id },
        "scheduled task skipped: website busy",
      );
      continue;
    }
    const claimed = await claimDueTask(task, now);
    if (!claimed) continue;

    busyWebsites.add(task.websiteId);
    started += 1;
    void (async () => {
      try {
        await run({ websiteId: task.websiteId, taskId: task.id });
        log?.info?.(
          { websiteId: task.websiteId, taskId: task.id },
          "scheduled task run finished",
        );
      } catch (err) {
        log?.error?.(
          { err, websiteId: task.websiteId, taskId: task.id },
          "scheduled task run failed",
        );
        // Ensure schedule is not stuck on CLAIM_HOLD_UNTIL if runner threw early.
        try {
          const current = await prisma.scheduledTask.findUnique({
            where: { id: task.id },
          });
          if (
            current &&
            current.nextRunAt?.getTime() === CLAIM_HOLD_UNTIL.getTime()
          ) {
            await prisma.scheduledTask.update({
              where: { id: task.id },
              data: {
                lastStatus: "error",
                lastError:
                  err instanceof Error
                    ? err.message.slice(0, 1000)
                    : String(err).slice(0, 1000),
                nextRunAt: task.nextRunAt,
              },
            });
          }
        } catch {
          /* ignore recovery errors */
        }
      } finally {
        busyWebsites.delete(task.websiteId);
      }
    })();
  }

  return started;
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startScheduledTaskPoller(
  log: FastifyBaseLogger,
  opts?: { intervalMs?: number },
) {
  if (intervalHandle) return;
  const intervalMs = opts?.intervalMs ?? DEFAULT_INTERVAL_MS;
  log.info({ intervalMs }, "starting scheduled task poller");

  const tick = () => {
    void pollDueScheduledTasks({ log }).catch((err) => {
      log.error({ err }, "scheduled task poll tick failed");
    });
  };

  // First tick shortly after boot so due tasks don't wait a full interval.
  setTimeout(tick, 2_000);
  intervalHandle = setInterval(tick, intervalMs);
  if (typeof intervalHandle.unref === "function") {
    intervalHandle.unref();
  }
}

export function stopScheduledTaskPoller() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  busyWebsites.clear();
}

/** Test helper */
export function _resetPollerStateForTests() {
  stopScheduledTaskPoller();
}
