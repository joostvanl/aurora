import { assertSafeUrl, WebFetchError } from "./webFetch.js";

export const MCP_TIMEOUT_MS = 15_000;
export const MCP_MAX_BODY_BYTES = 1_500_000;
export const MCP_PROTOCOL_VERSION = "2024-11-05";

export class McpClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpClientError";
  }
}

export type McpSourceAuth = {
  url: string;
  authHeaderName: string;
  authHeaderValue?: string;
};

export type CompactMcpTool = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
};

type JsonRpcSuccess = {
  jsonrpc?: string;
  id?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

function isSafeHeaderName(name: string): boolean {
  return /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name);
}

function compactInputSchema(schema: unknown): Record<string, unknown> | undefined {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return undefined;
  }
  const rec = schema as Record<string, unknown>;
  const propertiesIn =
    rec.properties && typeof rec.properties === "object" && !Array.isArray(rec.properties)
      ? (rec.properties as Record<string, unknown>)
      : undefined;
  const properties = propertiesIn
    ? Object.fromEntries(
        Object.entries(propertiesIn).map(([key, value]) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            return [key, {}];
          }
          const field = value as Record<string, unknown>;
          const compact: Record<string, unknown> = {};
          if (typeof field.type === "string") compact.type = field.type;
          if (typeof field.description === "string") {
            compact.description = field.description.slice(0, 160);
          }
          return [key, compact];
        }),
      )
    : undefined;
  const out: Record<string, unknown> = {};
  if (typeof rec.type === "string") out.type = rec.type;
  if (Array.isArray(rec.required)) out.required = rec.required.filter((v) => typeof v === "string");
  if (properties) out.properties = properties;
  return Object.keys(out).length ? out : undefined;
}

async function readBodyLimited(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new McpClientError(`MCP response larger than ${maxBytes} bytes`);
    }
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new McpClientError(`MCP response larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(out);
}

function parseSseJson(text: string): JsonRpcSuccess | null {
  const payloads: JsonRpcSuccess[] = [];
  for (const block of text.split(/\n\n+/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    if (dataLines.length === 0) continue;
    try {
      const parsed = JSON.parse(dataLines.join("\n")) as JsonRpcSuccess;
      payloads.push(parsed);
    } catch {
      /* skip non-JSON SSE frames */
    }
  }
  return (
    payloads.find((p) => p.result !== undefined || p.error !== undefined) ??
    payloads.at(-1) ??
    null
  );
}

function parseRpcBody(contentType: string, text: string): JsonRpcSuccess {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new McpClientError("Empty MCP response");
  }
  if (contentType.includes("text/event-stream")) {
    const fromSse = parseSseJson(trimmed);
    if (!fromSse) throw new McpClientError("MCP SSE response had no JSON-RPC payload");
    return fromSse;
  }
  try {
    return JSON.parse(trimmed) as JsonRpcSuccess;
  } catch {
    const fromSse = parseSseJson(trimmed);
    if (fromSse) return fromSse;
    throw new McpClientError("MCP response was not valid JSON-RPC");
  }
}

async function mcpRpc(
  source: McpSourceAuth,
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
): Promise<{ body: JsonRpcSuccess; sessionId?: string }> {
  let url: URL;
  try {
    url = await assertSafeUrl(source.url);
  } catch (error) {
    const message =
      error instanceof WebFetchError ? error.message : "Invalid MCP source URL";
    throw new McpClientError(message);
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "User-Agent": "AuroraCMS-AI/1.0",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const headerName = source.authHeaderName.trim();
  if (source.authHeaderValue && headerName && isSafeHeaderName(headerName)) {
    headers[headerName] = source.authHeaderValue;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MCP_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "POST",
      redirect: "error",
      signal: controller.signal,
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new McpClientError("MCP request timed out");
    }
    throw new McpClientError(
      error instanceof Error ? error.message : "MCP request failed",
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status < 200 || response.status >= 300) {
    throw new McpClientError(`MCP HTTP ${response.status}`);
  }

  const text = await readBodyLimited(response, MCP_MAX_BODY_BYTES);
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const body = parseRpcBody(contentType, text);
  if (body.error) {
    throw new McpClientError(body.error.message || "MCP JSON-RPC error");
  }
  const nextSession =
    response.headers.get("mcp-session-id") ??
    response.headers.get("Mcp-Session-Id") ??
    sessionId;
  return { body, sessionId: nextSession ?? undefined };
}

async function withSession(
  source: McpSourceAuth,
  run: (sessionId?: string) => Promise<{ body: JsonRpcSuccess; sessionId?: string }>,
) {
  const initialized = await mcpRpc(
    source,
    "initialize",
    {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "aurora-studio-ai", version: "1.0.0" },
    },
  );
  return run(initialized.sessionId);
}

export async function listMcpTools(source: McpSourceAuth): Promise<CompactMcpTool[]> {
  const { body } = await withSession(source, (sessionId) =>
    mcpRpc(source, "tools/list", {}, sessionId),
  );
  const result = body.result;
  const tools =
    result && typeof result === "object" && !Array.isArray(result)
      ? (result as { tools?: unknown }).tools
      : undefined;
  if (!Array.isArray(tools)) {
    throw new McpClientError("MCP tools/list did not return a tools array");
  }
  return tools
    .filter((t) => t && typeof t === "object" && !Array.isArray(t))
    .map((t) => {
      const rec = t as Record<string, unknown>;
      const name = typeof rec.name === "string" ? rec.name : "";
      return {
        name,
        description: typeof rec.description === "string" ? rec.description : "",
        inputSchema: compactInputSchema(rec.inputSchema),
      };
    })
    .filter((t) => t.name);
}

export async function callMcpTool(
  source: McpSourceAuth,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const { body } = await withSession(source, (sessionId) =>
      mcpRpc(
        source,
        "tools/call",
        { name: toolName, arguments: args },
        sessionId,
      ),
    );
    const result = body.result;
    if (result && typeof result === "object" && !Array.isArray(result)) {
      const rec = result as { isError?: unknown };
      if (rec.isError === true) {
        return { ok: false, error: "Remote MCP tool returned isError" };
      }
    }
    return { ok: true, data: result ?? null };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "MCP tool call failed",
    };
  }
}
