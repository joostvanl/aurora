import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const findMany = vi.fn();

vi.mock("../db.js", () => ({
  prisma: {
    contentType: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}));

vi.mock("./webFetch.js", () => ({
  fetchPublicUrl: vi.fn(),
  WebFetchError: class WebFetchError extends Error {},
}));

import { executeAiTool, isPseudoContentTypeApiId } from "./tools.js";

const ctx = {
  websiteId: "ws1",
  role: "admin" as const,
  schemaChangeConfirmed: true,
};

describe("isPseudoContentTypeApiId", () => {
  it("flags meta / pseudo apiIds", () => {
    expect(isPseudoContentTypeApiId("__schema")).toBe(true);
    expect(isPseudoContentTypeApiId("schema")).toBe(true);
    expect(isPseudoContentTypeApiId("Content_Type")).toBe(true);
    expect(isPseudoContentTypeApiId("content-type")).toBe(true);
    expect(isPseudoContentTypeApiId("fields")).toBe(true);
    expect(isPseudoContentTypeApiId("__anything")).toBe(true);
  });

  it("leaves real apiIds untouched", () => {
    expect(isPseudoContentTypeApiId("page")).toBe(false);
    expect(isPseudoContentTypeApiId("post")).toBe(false);
    expect(isPseudoContentTypeApiId("product")).toBe(false);
    expect(isPseudoContentTypeApiId(undefined)).toBe(false);
    expect(isPseudoContentTypeApiId("")).toBe(false);
  });
});

describe("entry-tool pseudo content-type guardrail", () => {
  beforeEach(() => {
    findUnique.mockReset();
    findMany.mockReset();
  });

  it("blocks create_entry on __schema without touching the database", async () => {
    const result = await executeAiTool(
      "create_entry",
      { contentTypeApiId: "__schema", slug: "x", fields: {} },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/create_content_type/);
    expect(result.summary).toMatch(/not a content type/i);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("lists available content types when a normal apiId does not exist", async () => {
    findUnique.mockResolvedValue(null);
    findMany.mockResolvedValue([{ apiId: "page" }, { apiId: "post" }]);

    const result = await executeAiTool(
      "create_entry",
      { contentTypeApiId: "widget", slug: "x", fields: {} },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(result.summary).toMatch(/Available content types/);
    expect(result.summary).toMatch(/page, post/);
  });

  it("lets valid apiIds pass the guard through to the database", async () => {
    findUnique.mockResolvedValue(null);
    findMany.mockResolvedValue([]);

    const result = await executeAiTool(
      "get_entry",
      { contentTypeApiId: "page", slug: "home" },
      ctx,
    );

    expect(result.ok).toBe(false);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
