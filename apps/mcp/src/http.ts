import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpContextFromToken } from "./client.js";
import { createAuroraMcpServer } from "./createServer.js";

export type HandleAuroraMcpRequestOptions = {
  apiUrl: string;
  token: string;
  /** Fastify (or other) pre-parsed JSON body. */
  parsedBody?: unknown;
};

/**
 * Stateless Streamable HTTP handler: one MCP server + transport per request.
 * Caller must already have validated the Bearer token (aur_u_… / aur_…).
 */
export async function handleAuroraMcpRequest(
  request: Request,
  opts: HandleAuroraMcpRequestOptions,
): Promise<Response> {
  const ctx = await createMcpContextFromToken({
    apiUrl: opts.apiUrl,
    token: opts.token,
  });
  const server = createAuroraMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request, {
      parsedBody: opts.parsedBody,
    });
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
