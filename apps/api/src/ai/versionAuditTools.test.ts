import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueContentType = vi.fn();
const findFirstEntry = vi.fn();
const findFirstEntryVersion = vi.fn();
const findFirstContentTypeVersion = vi.fn();

const mockedListEntryVersions = vi.fn();
const mockedListContentTypeVersions = vi.fn();
const mockedListAuditEvents = vi.fn();
const mockedDiffEntrySnapshots = vi.fn();
const mockedDiffContentTypeSnapshots = vi.fn();

vi.mock("../db.js", () => ({
  prisma: {
    contentType: {
      findUnique: (...args: unknown[]) => findUniqueContentType(...args),
    },
    entry: {
      findFirst: (...args: unknown[]) => findFirstEntry(...args),
    },
    entryVersion: {
      findFirst: (...args: unknown[]) => findFirstEntryVersion(...args),
    },
    contentTypeVersion: {
      findFirst: (...args: unknown[]) => findFirstContentTypeVersion(...args),
    },
  },
}));

vi.mock("./webFetch.js", () => ({
  fetchPublicUrl: vi.fn(),
  WebFetchError: class WebFetchError extends Error {},
}));

vi.mock("../lib/versions.js", () => ({
  listEntryVersions: (...args: unknown[]) => mockedListEntryVersions(...args),
}));

vi.mock("../lib/contentTypeVersions.js", () => ({
  listContentTypeVersions: (...args: unknown[]) =>
    mockedListContentTypeVersions(...args),
}));

vi.mock("../lib/audit.js", () => ({
  listAuditEvents: (...args: unknown[]) => mockedListAuditEvents(...args),
  annotateAuditEvent: vi.fn(),
}));

vi.mock("../lib/snapshotDiff.js", () => ({
  diffEntrySnapshots: (...args: unknown[]) => mockedDiffEntrySnapshots(...args),
  diffContentTypeSnapshots: (...args: unknown[]) =>
    mockedDiffContentTypeSnapshots(...args),
}));

import { aiToolsForSource, executeAiTool } from "./tools.js";

const ct = {
  id: "ct1",
  websiteId: "ws1",
  apiId: "page",
  name: "Page",
  fields: [],
};

describe("version/audit tools — role & domain catalog", () => {
  it("does not offer content-type version tools to editors (viewer-equivalent)", () => {
    const names = aiToolsForSource("chat", {
      role: "editor",
      context: { pathname: "/content-types/page" },
    }).map((t) => t.function.name);
    expect(names).not.toContain("list_content_type_versions");
    expect(names).toContain("list_entry_versions");
    expect(names).toContain("list_audit_events");
    expect(names).toContain("diff_versions");
  });

  it("denies list_content_type_versions at execute time for editors", async () => {
    findUniqueContentType.mockResolvedValue(ct);
    const result = await executeAiTool(
      "list_content_type_versions",
      { apiId: "page" },
      { websiteId: "ws1", role: "editor" },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/Permission denied/);
    expect(mockedListContentTypeVersions).not.toHaveBeenCalled();
  });
});

describe("version/audit tools — website scoping", () => {
  beforeEach(() => {
    findUniqueContentType.mockReset();
    findFirstEntry.mockReset();
    findFirstEntryVersion.mockReset();
    findFirstContentTypeVersion.mockReset();
    mockedListEntryVersions.mockReset();
    mockedListContentTypeVersions.mockReset();
    mockedListAuditEvents.mockReset();
    mockedDiffEntrySnapshots.mockReset();
    mockedDiffContentTypeSnapshots.mockReset();
  });

  it("list_entry_versions resolves content type via websiteId and omits snapshots", async () => {
    findUniqueContentType.mockResolvedValue(ct);
    findFirstEntry.mockResolvedValue({ id: "e1", slug: "home" });
    mockedListEntryVersions.mockResolvedValue([
      {
        id: "v1",
        entryId: "e1",
        label: "Before AI edit",
        source: "ai",
        snapshot: {
          slug: "home",
          status: "draft",
          locale: "nl",
          fields: { title: "X" },
        },
        createdByUserId: "u1",
        actorKind: "ai",
        changeSummary: "edit",
        createdAt: "2026-08-17T10:00:00.000Z",
      },
    ]);

    const result = await executeAiTool(
      "list_entry_versions",
      { apiId: "page", entryId: "e1", limit: 10 },
      { websiteId: "ws1", role: "editor" },
    );

    expect(result.ok).toBe(true);
    expect(findUniqueContentType).toHaveBeenCalledWith({
      where: { websiteId_apiId: { websiteId: "ws1", apiId: "page" } },
      include: { fields: { orderBy: { sortOrder: "asc" } } },
    });
    expect(findFirstEntry).toHaveBeenCalledWith({
      where: { id: "e1", contentTypeId: "ct1" },
    });
    expect(mockedListEntryVersions).toHaveBeenCalledWith("e1", {
      limit: 10,
      offset: undefined,
    });
    expect(result.data).toEqual([
      {
        id: "v1",
        label: "Before AI edit",
        source: "ai",
        actorKind: "ai",
        changeSummary: "edit",
        createdAt: "2026-08-17T10:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(result.data)).not.toContain("snapshot");
    expect(JSON.stringify(result.data)).not.toContain("title");
  });

  it("list_entry_versions does not leak entries from another website", async () => {
    findUniqueContentType.mockResolvedValue(null);
    const result = await executeAiTool(
      "list_entry_versions",
      { apiId: "page", entryId: "foreign-entry" },
      { websiteId: "ws1", role: "admin" },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/not found/i);
    expect(mockedListEntryVersions).not.toHaveBeenCalled();
  });

  it("list_entry_versions hides entry ids that are not on the scoped content type", async () => {
    findUniqueContentType.mockResolvedValue(ct);
    findFirstEntry.mockResolvedValue(null);
    const result = await executeAiTool(
      "list_entry_versions",
      { apiId: "page", entryId: "other-site-entry" },
      { websiteId: "ws1", role: "admin" },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/not found/i);
    expect(mockedListEntryVersions).not.toHaveBeenCalled();
  });

  it("list_audit_events always passes ctx.websiteId", async () => {
    mockedListAuditEvents.mockResolvedValue([
      {
        id: "a1",
        websiteId: "ws1",
        actorUserId: "u1",
        actorKind: "user",
        action: "entry.update",
        resourceType: "entry",
        resourceId: "e1",
        summary: "Updated home",
        meta: { huge: "payload" },
        createdAt: "2026-08-17T11:00:00.000Z",
      },
    ]);

    const result = await executeAiTool(
      "list_audit_events",
      { resourceType: "entry", resourceId: "e1", limit: 5 },
      { websiteId: "ws1", role: "editor" },
    );

    expect(result.ok).toBe(true);
    expect(mockedListAuditEvents).toHaveBeenCalledWith({
      websiteId: "ws1",
      resourceType: "entry",
      resourceId: "e1",
      missingAiDetail: undefined,
      limit: 5,
      offset: undefined,
    });
    expect(result.data).toEqual([
      {
        id: "a1",
        actorUserId: "u1",
        actorKind: "user",
        action: "entry.update",
        resourceType: "entry",
        resourceId: "e1",
        summary: "Updated home",
        createdAt: "2026-08-17T11:00:00.000Z",
        aiDetail: undefined,
        aiDetailActorKind: undefined,
        aiDetailCreatedAt: undefined,
        aiDetailSource: undefined,
      },
    ]);
  });

  it("diff_versions for entries scopes versions to the website entry", async () => {
    findUniqueContentType.mockResolvedValue(ct);
    findFirstEntry.mockResolvedValue({ id: "e1", slug: "home" });
    findFirstEntryVersion
      .mockResolvedValueOnce({
        id: "v1",
        entryId: "e1",
        snapshot: { slug: "home", status: "draft", locale: "nl", fields: {} },
      })
      .mockResolvedValueOnce({
        id: "v2",
        entryId: "e1",
        snapshot: {
          slug: "home",
          status: "published",
          locale: "nl",
          fields: {},
        },
      });
    mockedDiffEntrySnapshots.mockReturnValue([
      { path: "status", before: "draft", after: "published" },
    ]);

    const result = await executeAiTool(
      "diff_versions",
      {
        kind: "entry",
        apiId: "page",
        entryId: "e1",
        fromVersionId: "v1",
        toVersionId: "v2",
      },
      { websiteId: "ws1", role: "editor" },
    );

    expect(result.ok).toBe(true);
    expect(findFirstEntryVersion).toHaveBeenCalledWith({
      where: { id: "v1", entryId: "e1" },
    });
    expect(findFirstEntryVersion).toHaveBeenCalledWith({
      where: { id: "v2", entryId: "e1" },
    });
    expect(result.data).toMatchObject({
      kind: "entry",
      from: "v1",
      to: "v2",
      changes: [{ path: "status", before: "draft", after: "published" }],
    });
  });

  it("diff_versions for content types is denied for editors", async () => {
    const result = await executeAiTool(
      "diff_versions",
      {
        kind: "content_type",
        apiId: "page",
        fromVersionId: "cv1",
        toVersionId: "cv2",
      },
      { websiteId: "ws1", role: "editor" },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/Permission denied/);
    expect(findUniqueContentType).not.toHaveBeenCalled();
  });
});
