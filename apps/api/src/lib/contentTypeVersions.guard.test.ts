import { beforeEach, describe, expect, it, vi } from "vitest";

const findUniqueOrThrow = vi.fn();
const createVersion = vi.fn();

vi.mock("../db.js", () => ({
  prisma: {
    contentType: {
      findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrow(...args),
    },
    contentTypeVersion: {
      create: (...args: unknown[]) => createVersion(...args),
    },
  },
}));

import { createAiContentTypeSnapshotGuard } from "./contentTypeVersions.js";

const ctRow = {
  id: "ct1",
  apiId: "page",
  name: "Page",
  description: null,
  localizationMode: "explicit" as const,
  fields: [],
};

describe("createAiContentTypeSnapshotGuard", () => {
  beforeEach(() => {
    findUniqueOrThrow.mockReset();
    createVersion.mockReset();
    findUniqueOrThrow.mockResolvedValue(ctRow);
    createVersion.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "v1",
      contentTypeId: data.contentTypeId,
      label: data.label ?? null,
      source: data.source,
      snapshot: { apiId: "page", name: "Page", description: null, localizationMode: "explicit", fields: [] },
      createdByUserId: data.createdByUserId ?? null,
      actorKind: data.actorKind ?? null,
      changeSummary: data.changeSummary ?? null,
      createdAt: new Date("2026-08-17T12:00:00.000Z"),
    }));
  });

  it("creates one contentTypeVersion with actorKind ai", async () => {
    const ensure = createAiContentTypeSnapshotGuard();
    const version = await ensure("ct1", { changeSummary: "Field body created" });

    expect(version).toMatchObject({
      contentTypeId: "ct1",
      source: "ai",
      actorKind: "ai",
      changeSummary: "Field body created",
      label: "Before AI edit",
    });
    expect(createVersion).toHaveBeenCalledTimes(1);
    expect(createVersion.mock.calls[0][0].data).toMatchObject({
      contentTypeId: "ct1",
      source: "ai",
      actorKind: "ai",
      changeSummary: "Field body created",
    });
  });

  it("dedupes multiple schema edits on the same content type", async () => {
    const ensure = createAiContentTypeSnapshotGuard();
    const first = await ensure("ct1", { changeSummary: "Field body created" });
    const second = await ensure("ct1", { changeSummary: "Field title created" });
    const third = await ensure("ct1", { changeSummary: "Field slug created" });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(third).toBeNull();
    expect(createVersion).toHaveBeenCalledTimes(1);
  });

  it("allows one snapshot per distinct content type", async () => {
    findUniqueOrThrow.mockResolvedValueOnce(ctRow).mockResolvedValueOnce({
      ...ctRow,
      id: "ct2",
      apiId: "post",
      name: "Post",
    });
    createVersion.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: `v-${data.contentTypeId}`,
      contentTypeId: data.contentTypeId,
      label: data.label ?? null,
      source: data.source,
      snapshot: {},
      createdByUserId: null,
      actorKind: data.actorKind ?? null,
      changeSummary: data.changeSummary ?? null,
      createdAt: new Date("2026-08-17T12:00:00.000Z"),
    }));

    const ensure = createAiContentTypeSnapshotGuard();
    await ensure("ct1", { changeSummary: "Field body created" });
    await ensure("ct2", { changeSummary: "Field body created" });

    expect(createVersion).toHaveBeenCalledTimes(2);
  });
});
