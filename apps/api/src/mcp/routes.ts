import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { handleAuroraMcpRequest } from "@cms/mcp/http";
import { looksLikeApiToken, resolveApiToken } from "../auth/apiTokens.js";

function readBearer(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== "string") return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export function mcpUpstreamUrl(): string {
  const override = process.env.CMS_MCP_UPSTREAM_URL?.trim().replace(/\/$/, "");
  if (override) return override;
  const port = process.env.PORT?.trim() || "4000";
  return `http://127.0.0.1:${port}`;
}

function unauthorized(reply: FastifyReply, message: string) {
  return reply.status(401).send({ message, code: "UNAUTHORIZED" });
}

function toWebRequest(request: FastifyRequest, apiUrl: string): Request {
  const path = request.url.startsWith("/") ? request.url : `/${request.url}`;
  const url = `${apiUrl}${path}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
  }
  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD" && method !== "DELETE";
  return new Request(url, {
    method,
    headers,
    body: hasBody ? JSON.stringify(request.body ?? null) : undefined,
  });
}

async function handleMcp(request: FastifyRequest, reply: FastifyReply) {
  const token = readBearer(request);
  if (!token) {
    return unauthorized(
      reply,
      "Authentication required. Use Authorization: Bearer aur_u_… or aur_…",
    );
  }
  if (!looksLikeApiToken(token)) {
    return unauthorized(
      reply,
      "MCP requires a personal access token (aur_u_…) or website token (aur_…)",
    );
  }

  const user = await resolveApiToken(token);
  if (!user) {
    return unauthorized(reply, "Invalid or expired API token");
  }

  const apiUrl = mcpUpstreamUrl();
  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD" && method !== "DELETE";

  try {
    const webRes = await handleAuroraMcpRequest(toWebRequest(request, apiUrl), {
      apiUrl,
      token,
      parsedBody: hasBody ? request.body : undefined,
    });

    reply.status(webRes.status);
    webRes.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (lower === "transfer-encoding" || lower === "content-length") return;
      reply.header(key, value);
    });
    const buf = Buffer.from(await webRes.arrayBuffer());
    if (buf.length === 0) {
      return reply.send();
    }
    return reply.send(buf);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    request.log.warn({ err }, "MCP request failed during context bootstrap");
    if (/rejected|invalid or expired|missing aurora token/i.test(message)) {
      return unauthorized(reply, message);
    }
    throw err;
  }
}

export async function registerMcpRoutes(app: FastifyInstance) {
  app.post("/mcp", handleMcp);
  app.get("/mcp", handleMcp);
  app.delete("/mcp", handleMcp);
}
