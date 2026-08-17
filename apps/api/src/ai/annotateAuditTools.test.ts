import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedAnnotateAuditEvent = vi.fn();
const mockedListAuditEvents = vi.fn();

vi.mock("../db.js", () => ({
  prisma: {
    contentType: { findUnique: vi.fn(), findMany: vi.fn() },
    entry: { findFirst: vi.fn() },
  },
}));

vi.mock("./webFetch.js", () => ({
  fetchPublicUrl: vi.fn(),
  WebFetchError: class WebFetchError extends Error {},
}));

vi.mock("../lib/audit.js", () => ({
  annotateAuditEvent: (...args: unknown[]) => mockedAnnotateAuditEvent(...args),
  listAuditEvents: (...args: unknown[]) => mockedListAuditEvents(...args),
}));

import { aiToolsForSource, executeAiTool } from "./tools.js";

describe("annotate_audit_event AI tool", () => {
  beforeEach(() => {
    mockedAnnotateAuditEvent.mockReset();
    mockedListAuditEvents.mockReset();
  });

  it("is available as core during scheduled_task", () => {
    const names = aiToolsForSource("scheduled_task").map((t) => t.function.name);
    expect(names).toContain("annotate_audit_event");
    expect(names).toContain("list_audit_events");
  });

  it("annotates with website scope and records audit_event.annotate", async () => {
    mockedAnnotateAuditEvent.mockResolvedValue({
      id: "ae1",
      websiteId: "ws1",
      actorUserId: "user1",
      actorKind: "user",
      action: "entry.update",
      resourceType: "entry",
      resourceId: "e1",
      summary: "Entry updated",
      meta: null,
      createdAt: "2026-08-16T10:00:00.000Z",
      aiDetail: "Title changed from A to B",
      aiDetailActorKind: "ai",
      aiDetailCreatedAt: "2026-08-17T12:00:00.000Z",
      aiDetailSource: "scheduled_task",
    });
    const recordAudit = vi.fn();

    const result = await executeAiTool(
      "annotate_audit_event",
      {
        auditEventId: "ae1",
        detail: "Title changed from A to B",
        force: true,
      },
      {
        websiteId: "ws1",
        role: "admin",
        source: "scheduled_task",
        recordAudit,
      },
    );

    expect(result.ok).toBe(true);
    expect(mockedAnnotateAuditEvent).toHaveBeenCalledWith({
      websiteId: "ws1",
      auditEventId: "ae1",
      detail: "Title changed from A to B",
      actorKind: "ai",
      source: "scheduled_task",
    });
    // force must never be forwarded from AI tool args
    expect(mockedAnnotateAuditEvent.mock.calls[0][0].force).toBeUndefined();
    expect(recordAudit).toHaveBeenCalledWith({
      action: "audit_event.annotate",
      resourceType: "entry",
      resourceId: "e1",
      summary: "Annotated audit event ae1",
      meta: {
        tool: "annotate_audit_event",
        annotatedAuditEventId: "ae1",
        action: "entry.update",
      },
    });
  });

  it("passes missingAiDetail to list_audit_events", async () => {
    mockedListAuditEvents.mockResolvedValue([]);
    await executeAiTool(
      "list_audit_events",
      { missingAiDetail: true, limit: 20 },
      { websiteId: "ws1", role: "editor" },
    );
    expect(mockedListAuditEvents).toHaveBeenCalledWith({
      websiteId: "ws1",
      resourceType: undefined,
      resourceId: undefined,
      missingAiDetail: true,
      limit: 20,
      offset: undefined,
    });
  });

  it("surfaces annotate conflicts without recording audit", async () => {
    const err = Object.assign(new Error("Audit event already has an AI detail"), {
      statusCode: 409,
      apiCode: "CONFLICT",
    });
    mockedAnnotateAuditEvent.mockRejectedValue(err);
    const recordAudit = vi.fn();

    const result = await executeAiTool(
      "annotate_audit_event",
      { auditEventId: "ae1", detail: "again" },
      { websiteId: "ws1", role: "admin", recordAudit },
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/already has an AI detail/i);
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
