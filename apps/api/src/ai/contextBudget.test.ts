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

  it("keeps MCP team rows instead of omitting the whole get_club_teams result", () => {
    const teams = Array.from({ length: 40 }, (_, i) => ({
      id: `team:nevobo:${String(i).padStart(8, "0")}-aaaa-bbbb-cccc-ddddeeeeffff`,
      sourceId: `${String(i).padStart(8, "0")}-aaaa-bbbb-cccc-ddddeeeeffff`,
      name: `VTC Woerden DS ${i + 1}`,
      shortName: `DS ${i + 1}`,
      category: "senior",
      genderCategory: "women",
      teamNumber: i + 1,
      season: "2026-2027",
      clubId: "club:nevobo:ckl9x7n",
      competitions: [
        {
          id: "competition:nevobo:regio-west/competitie-seniorencompetitie-1",
          pouleId: `/competitie/poules/regio-west/competitie-seniorencompetitie-1/regio-west-d1h-${i}`,
          name: "Seniorencompetitie",
          type: "league",
          classification: {
            confidence: "authoritative",
            method: "explicit_source_field",
            evidence: ["/competitie/competitietypes/competitie"],
          },
        },
      ],
    }));
    const sources = Array.from({ length: 20 }, (_, i) => ({
      provider: "nevobo",
      sourceUrl: `https://api.nevobo.nl/competitie/page-${i}`,
      fetchedAt: "2026-09-13T15:38:15.531Z",
      parserVersion: "1.0.0",
    }));
    const result = {
      name: "call_external_source",
      ok: true,
      summary: "Called get_club_teams on Nevobo MCP",
      data: { data: teams, sources, schemaVersion: "1.0.0" },
    };
    expect(JSON.stringify(result).length).toBeGreaterThan(6_000);
    const out = truncateToolResultForModel(result, 6_000);
    expect(out.length).toBeLessThanOrEqual(6_000);
    const parsed = JSON.parse(out) as {
      dataTruncated?: boolean;
      data?: {
        omitted?: boolean;
        reason?: string;
        data?: Array<{ name?: string }>;
        items?: Array<{ name?: string }>;
        itemCount?: number;
      };
    };
    expect(parsed.data?.omitted).not.toBe(true);
    expect(parsed.data?.reason).not.toBe("tool result exceeds context budget");
    const rows = parsed.data?.data ?? parsed.data?.items ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((row) => row.name?.includes("VTC Woerden"))).toBe(true);
    expect(out).not.toContain("classification");
    expect(out).not.toContain("api.nevobo.nl");
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
