import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const findUniqueOrThrow = vi.fn();
const createContentType = vi.fn();
const createField = vi.fn();
const createEntry = vi.fn();
const findUniqueEntry = vi.fn();
const findUniqueWebsite = vi.fn();
const createContentTypeVersionRow = vi.fn();

vi.mock("../db.js", () => ({
  prisma: {
    contentType: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrow(...args),
      create: (...args: unknown[]) => createContentType(...args),
    },
    contentTypeVersion: {
      create: (...args: unknown[]) => createContentTypeVersionRow(...args),
    },
    fieldDefinition: {
      create: (...args: unknown[]) => createField(...args),
    },
    entry: {
      findUnique: (...args: unknown[]) => findUniqueEntry(...args),
      create: (...args: unknown[]) => createEntry(...args),
      findUniqueOrThrow: (...args: unknown[]) => findUniqueEntry(...args),
    },
    website: {
      findUniqueOrThrow: (...args: unknown[]) => findUniqueWebsite(...args),
    },
  },
}));

const createEntryVersion = vi.fn();

vi.mock("../lib/versions.js", () => ({
  createEntryVersion: (...args: unknown[]) => createEntryVersion(...args),
  resolveActorKind: (
    options: {
      actorKind?: string;
      source: string;
      createdByUserId?: string | null;
    },
  ) => {
    if (options.actorKind) return options.actorKind;
    if (options.source === "ai") return "ai";
    if (options.createdByUserId) return "user";
    return "system";
  },
  clampVersionLimit: (limit?: number, fallback = 50) =>
    Math.min(100, Math.max(1, limit == null || Number.isNaN(limit) ? fallback : Math.floor(limit))),
}));

vi.mock("../lib/entries.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/entries.js")>(
    "../lib/entries.js",
  );
  return {
    ...actual,
    setEntryFields: vi.fn(async () => undefined),
  };
});

vi.mock("../core/hooks.js", () => ({
  hooks: { emit: vi.fn(async () => undefined) },
}));

vi.mock("./webFetch.js", () => ({
  fetchPublicUrl: vi.fn(),
  WebFetchError: class WebFetchError extends Error {},
}));

import { createAiContentTypeSnapshotGuard } from "../lib/contentTypeVersions.js";
import { executeAiTool } from "./tools.js";

const now = new Date("2026-08-17T12:00:00.000Z");

function ctFixture(overrides?: Partial<{
  id: string;
  apiId: string;
  name: string;
  fields: Array<{
    id: string;
    apiId: string;
    name: string;
    type: string;
    required: boolean;
    sortOrder: number;
    settings: null;
  }>;
}>) {
  return {
    id: overrides?.id ?? "ct1",
    apiId: overrides?.apiId ?? "page",
    name: overrides?.name ?? "Page",
    description: null,
    localizationMode: "explicit" as const,
    fields: overrides?.fields ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

describe("AI schema + entry versioning", () => {
  beforeEach(() => {
    findUnique.mockReset();
    findUniqueOrThrow.mockReset();
    createContentType.mockReset();
    createField.mockReset();
    createEntry.mockReset();
    findUniqueEntry.mockReset();
    findUniqueWebsite.mockReset();
    createContentTypeVersionRow.mockReset();
    createEntryVersion.mockReset();
    findUniqueWebsite.mockResolvedValue({
      id: "ws1",
      defaultLocale: "nl-NL",
      locales: ["nl-NL"],
    });
    createContentTypeVersionRow.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: "ctv1",
        contentTypeId: data.contentTypeId,
        label: data.label ?? null,
        source: data.source,
        snapshot: {
          apiId: "page",
          name: "Page",
          description: null,
          localizationMode: "explicit",
          fields: [],
        },
        createdByUserId: data.createdByUserId ?? null,
        actorKind: data.actorKind ?? null,
        changeSummary: data.changeSummary ?? null,
        createdAt: now,
      }),
    );
  });

  it("AI schema change creates one contentTypeVersion with actorKind ai", async () => {
    const ensure = createAiContentTypeSnapshotGuard();
    const ct = ctFixture();
    findUnique.mockResolvedValue(ct);
    findUniqueOrThrow.mockResolvedValue(ct);
    createField.mockResolvedValue({ id: "f1" });

    const result = await executeAiTool(
      "create_field",
      {
        contentTypeApiId: "page",
        apiId: "body",
        name: "Body",
        type: "richtext",
      },
      {
        websiteId: "ws1",
        role: "admin",
        schemaChangeConfirmed: true,
        ensureAiContentTypeSnapshot: ensure,
      },
    );

    expect(result.ok).toBe(true);
    expect(createContentTypeVersionRow).toHaveBeenCalledTimes(1);
    expect(createContentTypeVersionRow.mock.calls[0][0].data).toMatchObject({
      contentTypeId: "ct1",
      source: "ai",
      actorKind: "ai",
      changeSummary: "Field body created",
    });
  });

  it("multi-field batch in one turn still yields one schema snapshot", async () => {
    const ensure = createAiContentTypeSnapshotGuard();
    const ct = ctFixture();
    findUnique.mockResolvedValue(ct);
    findUniqueOrThrow.mockResolvedValue(ct);
    createField.mockResolvedValue({ id: "f1" });

    const ctx = {
      websiteId: "ws1",
      role: "admin" as const,
      schemaChangeConfirmed: true,
      ensureAiContentTypeSnapshot: ensure,
    };

    const r1 = await executeAiTool(
      "create_field",
      { contentTypeApiId: "page", apiId: "body", name: "Body", type: "richtext" },
      ctx,
    );
    const r2 = await executeAiTool(
      "create_field",
      { contentTypeApiId: "page", apiId: "title", name: "Title", type: "text" },
      ctx,
    );
    const r3 = await executeAiTool(
      "create_field",
      { contentTypeApiId: "page", apiId: "slug", name: "Slug", type: "slug" },
      ctx,
    );

    expect(r1.ok && r2.ok && r3.ok).toBe(true);
    expect(createContentTypeVersionRow).toHaveBeenCalledTimes(1);
    expect(createContentTypeVersionRow.mock.calls[0][0].data).toMatchObject({
      actorKind: "ai",
      source: "ai",
      changeSummary: "Field body created",
    });
  });

  it("AI create_entry writes a Created version", async () => {
    const ct = ctFixture();
    findUnique.mockResolvedValue(ct);
    findUniqueEntry
      .mockResolvedValueOnce(null) // slug uniqueness check
      .mockResolvedValueOnce({
        id: "e1",
        slug: "home",
        locale: "nl-NL",
        status: "draft",
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
        contentType: { apiId: "page" },
        fieldValues: [],
        createdBy: null,
      });
    createEntry.mockResolvedValue({
      id: "e1",
      slug: "home",
      locale: "nl-NL",
      status: "draft",
    });
    createEntryVersion.mockResolvedValue({
      id: "ev1",
      label: "Created",
      source: "ai",
      actorKind: "ai",
    });

    const result = await executeAiTool(
      "create_entry",
      { contentTypeApiId: "page", slug: "home", fields: {} },
      { websiteId: "ws1", role: "admin" },
    );

    expect(result.ok).toBe(true);
    expect(createEntryVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: "e1",
        label: "Created",
        source: "ai",
        actorKind: "ai",
        changeSummary: "Entry created",
      }),
    );
  });
});
