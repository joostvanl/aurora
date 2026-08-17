import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueContentType = vi.fn();
const findFirstEntry = vi.fn();

const mockedRestoreEntryVersion = vi.fn();
const mockedRestoreContentTypeVersion = vi.fn();

vi.mock("../db.js", () => ({
  prisma: {
    contentType: {
      findUnique: (...args: unknown[]) => findUniqueContentType(...args),
    },
    entry: {
      findFirst: (...args: unknown[]) => findFirstEntry(...args),
    },
  },
}));

vi.mock("./webFetch.js", () => ({
  fetchPublicUrl: vi.fn(),
  WebFetchError: class WebFetchError extends Error {},
}));

vi.mock("../lib/versions.js", () => ({
  listEntryVersions: vi.fn(),
  createEntryVersion: vi.fn(),
  restoreEntryVersion: (...args: unknown[]) =>
    mockedRestoreEntryVersion(...args),
}));

vi.mock("../lib/contentTypeVersions.js", () => ({
  listContentTypeVersions: vi.fn(),
  restoreContentTypeVersion: (...args: unknown[]) =>
    mockedRestoreContentTypeVersion(...args),
}));

vi.mock("../lib/audit.js", () => ({
  listAuditEvents: vi.fn(),
}));

vi.mock("../lib/snapshotDiff.js", () => ({
  diffEntrySnapshots: vi.fn(),
  diffContentTypeSnapshots: vi.fn(),
}));

import {
  aiToolsForSource,
  executeAiTool,
  RESTORE_TOOLS,
  SCHEDULED_TASK_BLOCKED_TOOLS,
} from "./tools.js";

const ct = {
  id: "ct1",
  websiteId: "ws1",
  apiId: "page",
  name: "Page",
  fields: [],
};

describe("restore tools — confirmation & scheduled blocks", () => {
  beforeEach(() => {
    findUniqueContentType.mockReset();
    findFirstEntry.mockReset();
    mockedRestoreEntryVersion.mockReset();
    mockedRestoreContentTypeVersion.mockReset();
  });

  it("lists restore tools in RESTORE_TOOLS / SCHEDULED_TASK_BLOCKED_TOOLS", () => {
    expect(RESTORE_TOOLS.has("restore_entry_version")).toBe(true);
    expect(RESTORE_TOOLS.has("restore_content_type_version")).toBe(true);
    expect(SCHEDULED_TASK_BLOCKED_TOOLS.has("restore_entry_version")).toBe(
      true,
    );
    expect(
      SCHEDULED_TASK_BLOCKED_TOOLS.has("restore_content_type_version"),
    ).toBe(true);
  });

  it("omits restore tools from scheduled_task catalog even with allowPublish", () => {
    const names = aiToolsForSource("scheduled_task", {
      allowPublish: true,
      role: "admin",
    }).map((t) => t.function.name);
    expect(names).not.toContain("restore_entry_version");
    expect(names).not.toContain("restore_content_type_version");
    expect(names).toContain("publish_entry");
  });

  it("offers restore tools in studio chat for builders", () => {
    const names = aiToolsForSource("chat", {
      role: "builder",
      context: { pathname: "/content-types/page" },
    }).map((t) => t.function.name);
    expect(names).toContain("restore_entry_version");
    expect(names).toContain("restore_content_type_version");
  });

  it("blocks restore_entry_version without confirmation", async () => {
    const recordAudit = vi.fn();
    const result = await executeAiTool(
      "restore_entry_version",
      { apiId: "page", entryId: "e1", versionId: "v1" },
      {
        websiteId: "ws1",
        role: "editor",
        source: "chat",
        recordAudit,
      },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/approval|confirmation/i);
    expect(result.data).toEqual({
      needsConfirmation: true,
      tool: "restore_entry_version",
    });
    expect(mockedRestoreEntryVersion).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("blocks restore_content_type_version without confirmation", async () => {
    const result = await executeAiTool(
      "restore_content_type_version",
      { apiId: "page", versionId: "v1" },
      {
        websiteId: "ws1",
        role: "admin",
        source: "chat",
      },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/approval|confirmation/i);
    expect(mockedRestoreContentTypeVersion).not.toHaveBeenCalled();
  });

  it("restores an entry when confirmation is present and audits", async () => {
    findUniqueContentType.mockResolvedValue(ct);
    findFirstEntry.mockResolvedValue({ id: "e1", slug: "home" });
    mockedRestoreEntryVersion.mockResolvedValue({
      entry: { id: "e1", slug: "home" },
      restoredFrom: { id: "v1" },
    });
    const recordAudit = vi.fn();

    const result = await executeAiTool(
      "restore_entry_version",
      { apiId: "page", entryId: "e1", versionId: "v1" },
      {
        websiteId: "ws1",
        role: "editor",
        userId: "user1",
        source: "chat",
        schemaChangeConfirmed: true,
        recordAudit,
      },
    );

    expect(result.ok).toBe(true);
    expect(mockedRestoreEntryVersion).toHaveBeenCalledWith({
      contentTypeId: "ct1",
      entryId: "e1",
      versionId: "v1",
      createdByUserId: "user1",
    });
    expect(recordAudit).toHaveBeenCalledWith({
      action: "entry.restore",
      resourceType: "entry",
      resourceId: "e1",
      summary: "Restored entry home",
      meta: {
        tool: "restore_entry_version",
        versionId: "v1",
        contentTypeApiId: "page",
      },
    });
  });

  it("restores a content type when confirmation is present and audits", async () => {
    findUniqueContentType.mockResolvedValue(ct);
    mockedRestoreContentTypeVersion.mockResolvedValue({
      contentType: { id: "ct1", apiId: "page" },
      restoredFrom: { id: "v1" },
    });
    const recordAudit = vi.fn();

    const result = await executeAiTool(
      "restore_content_type_version",
      { apiId: "page", versionId: "v1" },
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
    expect(mockedRestoreContentTypeVersion).toHaveBeenCalledWith({
      contentTypeId: "ct1",
      versionId: "v1",
      createdByUserId: "user1",
    });
    expect(recordAudit).toHaveBeenCalledWith({
      action: "content_type.restore",
      resourceType: "content_type",
      resourceId: "ct1",
      summary: "Restored content type page",
      meta: {
        tool: "restore_content_type_version",
        versionId: "v1",
        contentTypeApiId: "page",
      },
    });
  });

  it("always blocks restore during scheduled_task even with allowPublish + confirmation", async () => {
    const recordAudit = vi.fn();
    const result = await executeAiTool(
      "restore_entry_version",
      { apiId: "page", entryId: "e1", versionId: "v1" },
      {
        websiteId: "ws1",
        role: "admin",
        source: "scheduled_task",
        allowPublish: true,
        schemaChangeConfirmed: true,
        recordAudit,
      },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/scheduled tasks cannot restore/i);
    expect(mockedRestoreEntryVersion).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("denies schema restore for editors (viewer-equivalent)", async () => {
    const result = await executeAiTool(
      "restore_content_type_version",
      { apiId: "page", versionId: "v1" },
      {
        websiteId: "ws1",
        role: "editor",
        schemaChangeConfirmed: true,
      },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/Permission denied/);
    expect(mockedRestoreContentTypeVersion).not.toHaveBeenCalled();
  });

  it("omits schema restore from the tool catalog for editors", () => {
    const names = aiToolsForSource("chat", {
      role: "editor",
      context: { pathname: "/content-types/page" },
    }).map((t) => t.function.name);
    expect(names).not.toContain("restore_content_type_version");
    expect(names).toContain("restore_entry_version");
  });
});
