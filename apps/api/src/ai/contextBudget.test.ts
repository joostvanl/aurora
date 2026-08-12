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

  it("truncates bulky tool data while keeping summary", () => {
    const result = {
      name: "get_entry",
      ok: true,
      summary: "Fetched entry",
      data: { body: "x".repeat(20_000) },
    };
    const out = truncateToolResultForModel(result, 1_000);
    expect(out.length).toBeLessThanOrEqual(1_000);
    expect(out).toContain("get_entry");
    expect(out).toContain("Fetched entry");
    expect(out).toContain("dataTruncated");
    expect(out.length).toBeLessThan(JSON.stringify(result).length);
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
