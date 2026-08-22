import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_HISTORY_MAX,
  DEFAULT_AI_TOOL_RESULT_MAX_CHARS,
  estimateChatInputChars,
  resolveHistoryMax,
  resolveToolResultMaxChars,
  truncateToolResultForModel,
} from "./contextBudget.js";

describe("contextBudget", () => {
  it("defaults history and tool-result budgets", () => {
    expect(resolveHistoryMax({})).toBe(DEFAULT_AI_HISTORY_MAX);
    expect(resolveToolResultMaxChars({})).toBe(DEFAULT_AI_TOOL_RESULT_MAX_CHARS);
  });

  it("honors CMS_AI_HISTORY_MAX / CMS_AI_TOOL_RESULT_MAX_CHARS", () => {
    expect(resolveHistoryMax({ CMS_AI_HISTORY_MAX: "8" })).toBe(8);
    expect(
      resolveToolResultMaxChars({ CMS_AI_TOOL_RESULT_MAX_CHARS: "2000" }),
    ).toBe(2000);
  });

  it("omits large get_entry strings with hashes instead of slicing (R5)", () => {
    const body = "x".repeat(20_000);
    const result = {
      name: "get_entry",
      ok: true,
      summary: "Fetched entry",
      data: {
        id: "e1",
        slug: "hello",
        fields: { title: "Hi", body },
      },
    };
    const out = truncateToolResultForModel(result, 1_000);
    expect(out.length).toBeLessThanOrEqual(1_000);
    const parsed = JSON.parse(out) as {
      dataTruncated?: boolean;
      data?: { fields?: { body?: { omitted?: boolean; sha256?: string; length?: number } } };
    };
    expect(parsed.dataTruncated).toBe(true);
    expect(parsed.data?.fields?.body?.omitted).toBe(true);
    expect(parsed.data?.fields?.body?.length).toBe(20_000);
    expect(parsed.data?.fields?.body?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(out).not.toContain("xxx");
    expect(out.endsWith("…")).toBe(false);
  });

  it("never slices get_entry_field even when over the 6k cap", () => {
    const value = "y".repeat(8_000);
    const result = {
      name: "get_entry_field",
      ok: true,
      summary: "Loaded field",
      data: { value, truncated: false },
    };
    const out = truncateToolResultForModel(result, 1_000);
    expect(out.length).toBeGreaterThan(8_000);
    expect(JSON.parse(out).data.value).toBe(value);
  });

  it("passes through small tool results unchanged", () => {
    const result = { name: "list_entries", ok: true, summary: "ok", data: [1] };
    expect(truncateToolResultForModel(result, 6_000)).toBe(
      JSON.stringify(result),
    );
  });

  it("estimates input chars from messages and tools", () => {
    const chars = estimateChatInputChars(
      [{ content: "hello" }, { content: "world" }],
      [
        {
          function: {
            name: "get_entry",
            description: "x",
            parameters: { type: "object" },
          },
        },
      ],
    );
    expect(chars).toBeGreaterThan(10);
  });
});
