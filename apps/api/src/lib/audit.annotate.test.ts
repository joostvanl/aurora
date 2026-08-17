import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const update = vi.fn();
const findMany = vi.fn();

vi.mock("../db.js", () => ({
  prisma: {
    auditEvent: {
      findFirst: (...args: unknown[]) => findFirst(...args),
      update: (...args: unknown[]) => update(...args),
      findMany: (...args: unknown[]) => findMany(...args),
      create: vi.fn(),
    },
  },
}));

import {
  annotateAuditEvent,
  listAuditEvents,
  serializeAuditEvent,
} from "./audit.js";

const baseRow = {
  id: "ae1",
  websiteId: "ws1",
  actorUserId: "user1",
  actorKind: "user",
  action: "entry.update",
  resourceType: "entry",
  resourceId: "e1",
  summary: "Entry updated",
  meta: { versionId: "v1" },
  createdAt: new Date("2026-08-16T10:00:00.000Z"),
  aiDetail: null as string | null,
  aiDetailActorKind: null as string | null,
  aiDetailCreatedAt: null as Date | null,
  aiDetailSource: null as string | null,
};

describe("serializeAuditEvent", () => {
  it("includes aiDetail* fields (null when unset)", () => {
    const dto = serializeAuditEvent(baseRow);
    expect(dto).toMatchObject({
      id: "ae1",
      summary: "Entry updated",
      action: "entry.update",
      actorKind: "user",
      actorUserId: "user1",
      createdAt: "2026-08-16T10:00:00.000Z",
      aiDetail: null,
      aiDetailActorKind: null,
      aiDetailCreatedAt: null,
      aiDetailSource: null,
    });
  });
});

describe("annotateAuditEvent", () => {
  beforeEach(() => {
    findFirst.mockReset();
    update.mockReset();
  });

  it("only sets aiDetail* and leaves original fields unchanged", async () => {
    findFirst.mockResolvedValue({ ...baseRow });
    const annotatedAt = new Date("2026-08-17T12:00:00.000Z");
    update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...baseRow,
      ...data,
      aiDetailCreatedAt: annotatedAt,
    }));

    const result = await annotateAuditEvent({
      websiteId: "ws1",
      auditEventId: "ae1",
      detail: "Changed title from Home to Welcome",
      actorKind: "ai",
      source: "scheduled_task",
    });

    expect(update).toHaveBeenCalledTimes(1);
    const updateArg = update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "ae1" });
    expect(Object.keys(updateArg.data).sort()).toEqual([
      "aiDetail",
      "aiDetailActorKind",
      "aiDetailCreatedAt",
      "aiDetailSource",
    ]);
    expect(updateArg.data).toMatchObject({
      aiDetail: "Changed title from Home to Welcome",
      aiDetailActorKind: "ai",
      aiDetailSource: "scheduled_task",
    });

    expect(result.summary).toBe("Entry updated");
    expect(result.action).toBe("entry.update");
    expect(result.actorKind).toBe("user");
    expect(result.actorUserId).toBe("user1");
    expect(result.createdAt).toBe("2026-08-16T10:00:00.000Z");
    expect(result.aiDetail).toBe("Changed title from Home to Welcome");
    expect(result.aiDetailActorKind).toBe("ai");
    expect(result.aiDetailSource).toBe("scheduled_task");
    expect(result.aiDetailCreatedAt).toBe("2026-08-17T12:00:00.000Z");
  });

  it("rejects a second enrichment when aiDetail is already set", async () => {
    findFirst.mockResolvedValue({
      ...baseRow,
      aiDetail: "Already enriched",
      aiDetailActorKind: "ai",
      aiDetailCreatedAt: new Date("2026-08-17T11:00:00.000Z"),
      aiDetailSource: "chat",
    });

    await expect(
      annotateAuditEvent({
        websiteId: "ws1",
        auditEventId: "ae1",
        detail: "Second try",
        actorKind: "ai",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringMatching(/already has an AI detail/i),
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("allows overwrite only when force=true", async () => {
    findFirst.mockResolvedValue({
      ...baseRow,
      aiDetail: "Already enriched",
      aiDetailActorKind: "ai",
      aiDetailCreatedAt: new Date("2026-08-17T11:00:00.000Z"),
      aiDetailSource: "chat",
    });
    update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...baseRow,
      ...data,
      aiDetailCreatedAt: new Date("2026-08-17T13:00:00.000Z"),
    }));

    const result = await annotateAuditEvent({
      websiteId: "ws1",
      auditEventId: "ae1",
      detail: "Forced rewrite",
      actorKind: "user",
      source: "admin",
      force: true,
    });

    expect(update).toHaveBeenCalledTimes(1);
    expect(result.aiDetail).toBe("Forced rewrite");
    expect(result.summary).toBe("Entry updated");
  });

  it("scopes lookup by websiteId (404 when other website)", async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      annotateAuditEvent({
        websiteId: "ws-other",
        auditEventId: "ae1",
        detail: "Should not apply",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: expect.stringMatching(/not found/i),
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "ae1", websiteId: "ws-other" },
    });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("listAuditEvents missingAiDetail", () => {
  beforeEach(() => {
    findMany.mockReset();
  });

  it("filters aiDetail: null when missingAiDetail is true", async () => {
    findMany.mockResolvedValue([]);
    await listAuditEvents({
      websiteId: "ws1",
      missingAiDetail: true,
      limit: 10,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          websiteId: "ws1",
          aiDetail: null,
        }),
      }),
    );
  });
});
