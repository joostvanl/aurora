import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./externalSources.js", () => ({
  listEnabledSources: vi.fn(),
  getEnabledSource: vi.fn(),
}));

vi.mock("./mcpClient.js", () => ({
  listMcpTools: vi.fn(),
  callMcpTool: vi.fn(),
  McpClientError: class McpClientError extends Error {
    name = "McpClientError";
  },
}));

import { getEnabledSource, listEnabledSources } from "./externalSources.js";
import { callMcpTool, listMcpTools } from "./mcpClient.js";
import { aiToolsForSource, executeAiTool } from "./tools.js";
import { truncateToolResultForModel } from "./contextBudget.js";

const listEnabled = listEnabledSources as ReturnType<typeof vi.fn>;
const getEnabled = getEnabledSource as ReturnType<typeof vi.fn>;
const listTools = listMcpTools as ReturnType<typeof vi.fn>;
const callTool = callMcpTool as ReturnType<typeof vi.fn>;

const sourceA = {
  id: "src-a",
  label: "Source A",
  type: "mcp_http" as const,
  url: "https://example.com/mcp",
  enabled: true,
  authHeaderName: "Authorization",
  authHeaderValue: "Bearer secret-should-never-leak",
};

describe("external source agent tools (CMS-61 T1–T7, S1)", () => {
  beforeEach(() => {
    listEnabled.mockReset();
    getEnabled.mockReset();
    listTools.mockReset();
    callTool.mockReset();
  });

  it("T1: list_external_sources returns only enabled id/label/type", async () => {
    listEnabled.mockResolvedValue([sourceA]);
    const result = await executeAiTool(
      "list_external_sources",
      {},
      { websiteId: "ws-a", role: "editor" },
    );
    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      { id: "src-a", label: "Source A", type: "mcp_http" },
    ]);
    expect(JSON.stringify(result)).not.toContain("example.com");
    expect(JSON.stringify(result)).not.toContain("secret-should-never-leak");
  });

  it("T2: unknown or disabled sourceId is ok:false", async () => {
    getEnabled.mockResolvedValue(null);
    const result = await executeAiTool(
      "list_external_source_tools",
      { sourceId: "missing" },
      { websiteId: "ws-a", role: "editor" },
    );
    expect(result.ok).toBe(false);
    expect(result.data).toBeUndefined();
  });

  it("T3: list_external_source_tools returns mock names", async () => {
    getEnabled.mockResolvedValue(sourceA);
    listTools.mockResolvedValue([
      { name: "whoami", description: "Current identity" },
    ]);
    const result = await executeAiTool(
      "list_external_source_tools",
      { sourceId: "src-a" },
      { websiteId: "ws-a", role: "editor" },
    );
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      sourceId: "src-a",
      tools: [{ name: "whoami", description: "Current identity" }],
    });
    expect(JSON.stringify(result)).not.toContain("secret-should-never-leak");
  });

  it("T4: call_external_source returns mock data", async () => {
    getEnabled.mockResolvedValue(sourceA);
    callTool.mockResolvedValue({
      ok: true,
      data: { email: "agent@example.com" },
    });
    const result = await executeAiTool(
      "call_external_source",
      { sourceId: "src-a", toolName: "whoami", arguments: {} },
      { websiteId: "ws-a", role: "editor" },
    );
    expect(result).toMatchObject({
      ok: true,
      data: { email: "agent@example.com" },
    });
  });

  it("T5: remote failure is ok:false with no invented payload", async () => {
    getEnabled.mockResolvedValue(sourceA);
    callTool.mockResolvedValue({ ok: false, error: "MCP HTTP 401" });
    const result = await executeAiTool(
      "call_external_source",
      { sourceId: "src-a", toolName: "whoami", arguments: {} },
      { websiteId: "ws-a", role: "editor" },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/401/);
    expect(result.data).toBeUndefined();
  });

  it("T5b: remote isError forwards the MCP error payload", async () => {
    getEnabled.mockResolvedValue(sourceA);
    callTool.mockResolvedValue({
      ok: false,
      error: "CLUB_NOT_FOUND: No club for CKN9X7N",
      data: { error: { code: "CLUB_NOT_FOUND" } },
    });
    const result = await executeAiTool(
      "call_external_source",
      { sourceId: "src-a", toolName: "get_club", arguments: { clubId: "CKN9X7N" } },
      { websiteId: "ws-a", role: "editor" },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/CLUB_NOT_FOUND/);
    expect(result.data).toEqual({ error: { code: "CLUB_NOT_FOUND" } });
  });

  it("T6: url instead of sourceId is rejected", async () => {
    const result = await executeAiTool(
      "call_external_source",
      { url: "https://evil.example/mcp", toolName: "whoami" },
      { websiteId: "ws-a", role: "editor" },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toMatch(/sourceId|Ad-hoc/i);
    expect(callTool).not.toHaveBeenCalled();
  });

  it("T7: large MCP payloads are truncated for the model", () => {
    const huge = "x".repeat(20_000);
    const out = truncateToolResultForModel(
      {
        name: "call_external_source",
        ok: true,
        summary: "Called whoami",
        data: { blob: huge },
      },
      1_000,
    );
    const parsed = JSON.parse(out) as { dataTruncated?: boolean };
    expect(parsed.dataTruncated).toBe(true);
    expect(out.length).toBeLessThan(2_000);
  });

  it("S1: a source from website A is not found in website B", async () => {
    getEnabled.mockImplementation(async (websiteId: string) =>
      websiteId === "ws-a" ? sourceA : null,
    );
    const result = await executeAiTool(
      "call_external_source",
      { sourceId: "src-a", toolName: "whoami" },
      { websiteId: "ws-b", role: "editor" },
    );
    expect(result.ok).toBe(false);
    expect(callTool).not.toHaveBeenCalled();
  });

  it("T8: scheduled_task advertises the three external-source tools", () => {
    const names = aiToolsForSource("scheduled_task").map((t) => t.function.name);
    expect(names).toContain("list_external_sources");
    expect(names).toContain("list_external_source_tools");
    expect(names).toContain("call_external_source");
    expect(names).toContain("fetch_url");
  });
});
