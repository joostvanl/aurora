import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpContext } from "@cms/mcp/client";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";
import { hashPassword, signAccessToken } from "../auth/password.js";
import {
  generateApiTokenSecret,
  generateUserApiTokenSecret,
} from "../auth/apiTokens.js";
import { createWebsiteWithAdmin } from "../auth/websites.js";

const INIT = {
  jsonrpc: "2.0" as const,
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "cms-59-test", version: "0.0.0" },
  },
};

async function postMcp(
  baseUrl: string,
  token: string | null,
  body: unknown,
  extraHeaders?: Record<string, string>,
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...extraHeaders,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("hosted MCP /mcp", () => {
  const appPromise = buildApp({ logger: false });
  let baseUrl = "";
  const createdUserIds: string[] = [];
  const createdWebsiteIds: string[] = [];
  let dbOk = false;

  beforeAll(async () => {
    const app = await appPromise;
    await app.listen({ host: "127.0.0.1", port: 0 });
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
    process.env.CMS_MCP_UPSTREAM_URL = baseUrl;
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }
  });

  afterAll(async () => {
    if (createdUserIds.length) {
      await prisma.userApiToken.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.membership.deleteMany({
        where: { userId: { in: createdUserIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
    if (createdWebsiteIds.length) {
      await prisma.website.deleteMany({
        where: { id: { in: createdWebsiteIds } },
      });
    }
    const app = await appPromise;
    await app.close();
  });

  it("stdio createMcpContext throws without CMS_API_URL", async () => {
    const prevUrl = process.env.CMS_API_URL;
    const prevUser = process.env.CMS_USER_TOKEN;
    delete process.env.CMS_API_URL;
    process.env.CMS_USER_TOKEN = "aur_u_placeholder";
    await expect(createMcpContext()).rejects.toThrow(/CMS_API_URL/);
    if (prevUrl === undefined) delete process.env.CMS_API_URL;
    else process.env.CMS_API_URL = prevUrl;
    if (prevUser === undefined) delete process.env.CMS_USER_TOKEN;
    else process.env.CMS_USER_TOKEN = prevUser;
  });

  it("POST /mcp without Bearer → 401 UNAUTHORIZED", async () => {
    const res = await postMcp(baseUrl, null, INIT);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("POST /mcp with session JWT → 401", async () => {
    const jwt = await signAccessToken({
      id: "user_not_used",
      email: "jwt@test.local",
      name: null,
      websiteId: null,
      websiteName: null,
      role: null,
      siteKey: null,
    });
    const res = await postMcp(baseUrl, jwt, INIT);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("POST /mcp with non-token Bearer → 401", async () => {
    const res = await postMcp(baseUrl, "not-a-token", INIT);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("POST /mcp with unknown aur_u_ token → 401", async (ctx) => {
    if (!dbOk) {
      ctx.skip();
      return;
    }
    const res = await postMcp(baseUrl, "aur_u_this_token_does_not_exist", INIT);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("POST /mcp with unknown aur_ website token → 401", async (ctx) => {
    if (!dbOk) {
      ctx.skip();
      return;
    }
    const res = await postMcp(baseUrl, "aur_this_token_does_not_exist", INIT);
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("GET /mcp without Bearer is not 404", async () => {
    const res = await fetch(`${baseUrl}/mcp`);
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(401);
  });

  it("DELETE /mcp without Bearer is not 404", async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: "DELETE" });
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(401);
  });

  it("valid PAT: initialize + tools/list + whoami (single website)", async (ctx) => {
    if (!dbOk) {
      ctx.skip();
      return;
    }
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await prisma.user.create({
      data: {
        email: `cms59-${stamp}@test.local`,
        passwordHash: hashPassword("test-test-test"),
        name: "CMS-59 tester",
      },
    });
    createdUserIds.push(user.id);
    const website = await createWebsiteWithAdmin({
      userId: user.id,
      name: `CMS-59 ${stamp}`,
    });
    createdWebsiteIds.push(website.id);
    const generated = generateUserApiTokenSecret();
    await prisma.userApiToken.create({
      data: {
        userId: user.id,
        name: "mcp-test",
        tokenHash: generated.hash,
        prefix: generated.prefix,
      },
    });

    const initRes = await postMcp(baseUrl, generated.raw, INIT);
    expect(initRes.status).toBe(200);
    const initJson = (await initRes.json()) as {
      result?: { serverInfo?: { name?: string } };
    };
    expect(initJson.result?.serverInfo?.name).toBe("aurora-cms");

    const listRes = await postMcp(baseUrl, generated.raw, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as {
      result?: { tools?: Array<{ name: string }> };
    };
    const names = (listJson.result?.tools ?? []).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "whoami",
        "list_websites",
        "select_website",
        "list_entries",
      ]),
    );

    const whoRes = await postMcp(baseUrl, generated.raw, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "whoami", arguments: {} },
    });
    expect(whoRes.status).toBe(200);
    const whoJson = (await whoRes.json()) as {
      result?: { content?: Array<{ text?: string }> };
    };
    const snapshot = JSON.parse(whoJson.result?.content?.[0]?.text ?? "{}") as {
      email?: string;
      websiteId?: string | null;
      role?: string | null;
    };
    expect(snapshot.email).toBe(user.email);
    expect(snapshot.websiteId).toBe(website.id);
    expect(snapshot.role).toBe("admin");
  });

  it("select_website persists for the next HTTP request (multi-site PAT)", async (ctx) => {
    if (!dbOk) {
      ctx.skip();
      return;
    }
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await prisma.user.create({
      data: {
        email: `cms59-multi-${stamp}@test.local`,
        passwordHash: hashPassword("test-test-test"),
        name: "CMS-59 multi",
      },
    });
    createdUserIds.push(user.id);
    const siteA = await createWebsiteWithAdmin({
      userId: user.id,
      name: `CMS-59 A ${stamp}`,
    });
    const siteB = await createWebsiteWithAdmin({
      userId: user.id,
      name: `CMS-59 B ${stamp}`,
    });
    createdWebsiteIds.push(siteA.id, siteB.id);
    const generated = generateUserApiTokenSecret();
    await prisma.userApiToken.create({
      data: {
        userId: user.id,
        name: "mcp-test-multi",
        tokenHash: generated.hash,
        prefix: generated.prefix,
      },
    });

    const before = await postMcp(baseUrl, generated.raw, {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "whoami", arguments: {} },
    });
    expect(before.status).toBe(200);
    const beforeSnap = JSON.parse(
      ((await before.json()) as { result?: { content?: Array<{ text?: string }> } })
        .result?.content?.[0]?.text ?? "{}",
    ) as { websiteId?: string | null };
    expect(beforeSnap.websiteId).toBeNull();

    const selectRes = await postMcp(baseUrl, generated.raw, {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "select_website",
        arguments: { websiteId: siteB.id },
      },
    });
    expect(selectRes.status).toBe(200);
    const selectSnap = JSON.parse(
      ((await selectRes.json()) as { result?: { content?: Array<{ text?: string }> } })
        .result?.content?.[0]?.text ?? "{}",
    ) as { websiteId?: string | null };
    expect(selectSnap.websiteId).toBe(siteB.id);

    const after = await postMcp(baseUrl, generated.raw, {
      jsonrpc: "2.0",
      id: 12,
      method: "tools/call",
      params: { name: "whoami", arguments: {} },
    });
    const afterSnap = JSON.parse(
      ((await after.json()) as { result?: { content?: Array<{ text?: string }> } })
        .result?.content?.[0]?.text ?? "{}",
    ) as { websiteId?: string | null };
    expect(afterSnap.websiteId).toBe(siteB.id);

    const me = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${generated.raw}` },
    });
    expect(me.status).toBe(200);
    const meJson = (await me.json()) as { user?: { websiteId?: string | null } };
    expect(meJson.user?.websiteId).toBe(siteB.id);
  });

  it("website-scoped token cannot select_website", async (ctx) => {
    if (!dbOk) {
      ctx.skip();
      return;
    }
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await prisma.user.create({
      data: {
        email: `cms59-site-${stamp}@test.local`,
        passwordHash: hashPassword("test-test-test"),
      },
    });
    createdUserIds.push(user.id);
    const website = await createWebsiteWithAdmin({
      userId: user.id,
      name: `CMS-59 site token ${stamp}`,
    });
    createdWebsiteIds.push(website.id);
    const generated = generateApiTokenSecret();
    await prisma.apiToken.create({
      data: {
        websiteId: website.id,
        createdById: user.id,
        name: "mcp-site-token",
        tokenHash: generated.hash,
        prefix: generated.prefix,
      },
    });

    const selectRes = await postMcp(baseUrl, generated.raw, {
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "select_website",
        arguments: { websiteId: website.id },
      },
    });
    expect(selectRes.status).toBe(200);
    const payload = (await selectRes.json()) as {
      result?: { isError?: boolean; content?: Array<{ text?: string }> };
    };
    expect(payload.result?.isError).toBe(true);
    expect(payload.result?.content?.[0]?.text ?? "").toMatch(/cannot switch/i);
  });
});
