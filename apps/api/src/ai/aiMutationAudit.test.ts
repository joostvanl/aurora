import { beforeEach, describe, expect, it, vi } from "vitest";

const contentTypeCreate = vi.fn();

vi.mock("../db.js", () => ({
  prisma: {
    contentType: {
      create: (...args: unknown[]) => contentTypeCreate(...args),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("./webFetch.js", () => ({
  fetchPublicUrl: vi.fn(),
  WebFetchError: class WebFetchError extends Error {},
}));

vi.mock("../core/hooks.js", () => ({
  hooks: { emit: vi.fn() },
}));

import { executeAiTool } from "./tools.js";

describe("AI mutation audit hook", () => {
  beforeEach(() => {
    contentTypeCreate.mockReset();
  });

  it("records exactly one audit event after a successful mutation", async () => {
    contentTypeCreate.mockResolvedValue({
      id: "ct1",
      websiteId: "ws1",
      apiId: "page",
      name: "Page",
      description: null,
      localizationMode: "explicit",
      fields: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const recordAudit = vi.fn();

    const result = await executeAiTool(
      "create_content_type",
      { apiId: "page", name: "Page" },
      {
        websiteId: "ws1",
        role: "admin",
        userId: "user1",
        source: "chat",
        schemaChangeConfirmed: true,
        recordAudit,
      },
    );

    expect(result.ok).toBe(true);
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith({
      action: "content_type.create",
      resourceType: "content_type",
      resourceId: "ct1",
      summary: "Created content type page",
      meta: { tool: "create_content_type" },
    });
  });

  it("does not record audit when draft-only blocks publish", async () => {
    const recordAudit = vi.fn();

    const result = await executeAiTool(
      "publish_entry",
      { contentTypeApiId: "page", entryId: "e1" },
      {
        websiteId: "ws1",
        role: "admin",
        source: "scheduled_task",
        allowPublish: false,
        recordAudit,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/draft-only/i);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("does not record audit when permission blocks a schema tool", async () => {
    const recordAudit = vi.fn();

    const result = await executeAiTool(
      "create_content_type",
      { apiId: "page", name: "Page" },
      {
        websiteId: "ws1",
        role: "editor",
        schemaChangeConfirmed: true,
        recordAudit,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/Permission denied/i);
    expect(recordAudit).not.toHaveBeenCalled();
    expect(contentTypeCreate).not.toHaveBeenCalled();
  });
});
