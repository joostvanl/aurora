import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callMcpTool,
  listMcpTools,
  stripMcpProvenance,
  unwrapMcpToolResult,
} from "./mcpClient.js";

const source = {
  url: "https://example.com/mcp",
  authHeaderName: "Authorization",
  authHeaderValue: "Bearer test-token",
};

function jsonResponse(body: unknown, init?: { status?: number; sse?: boolean }) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "content-type": init?.sse
        ? "text/event-stream"
        : "application/json",
    },
  });
}

describe("mcpClient (CMS-61)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("S2: refuses a private URL before fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await callMcpTool(
      { url: "http://127.0.0.1:9", authHeaderName: "Authorization" },
      "whoami",
      {},
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not allowed|Private|Local/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lists tools from a JSON-RPC initialize + tools/list pair", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2024-11-05" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: "2.0",
          id: 2,
          result: {
            tools: [
              {
                name: "whoami",
                description: "Current user",
                inputSchema: {
                  type: "object",
                  properties: {
                    verbose: { type: "boolean", description: "Include extra fields" },
                  },
                  required: [],
                },
              },
            ],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const tools = await listMcpTools(source);
    expect(tools).toEqual([
      {
        name: "whoami",
        description: "Current user",
        inputSchema: {
          type: "object",
          properties: {
            verbose: { type: "boolean", description: "Include extra fields" },
          },
          required: [],
        },
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const auth = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(auth.Authorization).toBe("Bearer test-token");
  });

  it("T5: remote HTTP 401 becomes ok:false without invented data", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ jsonrpc: "2.0", id: 1, result: {} }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: "nope" }, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callMcpTool(source, "whoami", {});
    expect(result).toEqual({ ok: false, error: "MCP HTTP 401" });
  });

  it("T5: remote isError is ok:false", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: "2.0", id: 1, result: {} }))
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: "2.0",
          id: 2,
          result: { isError: true, content: [{ type: "text", text: "boom" }] },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callMcpTool(source, "whoami", {});
    expect(result).toEqual({
      ok: false,
      error: "boom",
      data: "boom",
    });
  });

  it("T5: isError JSON payload is forwarded (CLUB_NOT_FOUND)", async () => {
    const payload = {
      error: { code: "CLUB_NOT_FOUND", message: "No club for CKN9X7N" },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: "2.0", id: 1, result: {} }))
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: "2.0",
          id: 2,
          result: {
            isError: true,
            content: [{ type: "text", text: JSON.stringify(payload) }],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callMcpTool(source, "get_club", { clubId: "CKN9X7N" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("CLUB_NOT_FOUND: No club for CKN9X7N");
      expect(result.data).toEqual(payload);
    }
  });

  it("unwraps tools/call text JSON and drops sources", async () => {
    const envelope = {
      data: [{ id: "team:1", name: "DS 1" }],
      sources: [{ sourceUrl: "https://api.example/x" }],
      schemaVersion: "1.0.0",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: "2.0", id: 1, result: {} }))
      .mockResolvedValueOnce(
        jsonResponse({
          jsonrpc: "2.0",
          id: 2,
          result: {
            content: [{ type: "text", text: JSON.stringify(envelope) }],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callMcpTool(source, "get_club_teams", { clubId: "CKL9X7N" });
    expect(result).toEqual({
      ok: true,
      data: {
        data: [{ id: "team:1", name: "DS 1" }],
        sourcesOmitted: 1,
        schemaVersion: "1.0.0",
      },
    });
  });

  it("stripMcpProvenance / unwrapMcpToolResult are idempotent on business JSON", () => {
    const raw = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            data: [{ id: "c1", name: "Club" }],
            sources: [{ a: 1 }, { b: 2 }],
          }),
        },
      ],
    };
    expect(unwrapMcpToolResult(raw)).toEqual({
      data: [{ id: "c1", name: "Club" }],
      sourcesOmitted: 2,
    });
    expect(stripMcpProvenance({ sources: [1, 2, 3], ok: true })).toEqual({
      sourcesOmitted: 3,
      ok: true,
    });
  });
});
