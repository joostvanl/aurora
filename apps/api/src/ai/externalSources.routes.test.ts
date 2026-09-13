import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { prisma } from "../db.js";
import { hashPassword, signAccessToken } from "../auth/password.js";
import { createWebsiteWithAdmin } from "../auth/websites.js";

describe("external sources routes (CMS-61 C1, C6, C7)", () => {
  const appPromise = buildApp({ logger: false });
  const createdUserIds: string[] = [];
  const createdWebsiteIds: string[] = [];
  let dbOk = false;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }
  });

  afterAll(async () => {
    if (createdWebsiteIds.length) {
      await prisma.setting.deleteMany({
        where: { websiteId: { in: createdWebsiteIds } },
      });
      await prisma.membership.deleteMany({
        where: { websiteId: { in: createdWebsiteIds } },
      });
      await prisma.website.deleteMany({
        where: { id: { in: createdWebsiteIds } },
      });
    }
    if (createdUserIds.length) {
      await prisma.user.deleteMany({
        where: { id: { in: createdUserIds } },
      });
    }
    const app = await appPromise;
    await app.close();
  });

  it("rejects unauthenticated GET with 401", async () => {
    const app = await appPromise;
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/admin/ai/external-sources",
    });
    expect(res.statusCode).toBe(401);
  });

  it("C1/C6/C7: admin write, editor read without secrets, editor PUT 403", async (ctx) => {
    if (!dbOk) {
      ctx.skip();
      return;
    }
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const admin = await prisma.user.create({
      data: {
        email: `cms61-admin-${stamp}@test.local`,
        passwordHash: hashPassword("test-test-test"),
        name: "CMS-61 admin",
      },
    });
    createdUserIds.push(admin.id);
    const website = await createWebsiteWithAdmin({
      userId: admin.id,
      name: `CMS-61 ${stamp}`,
    });
    createdWebsiteIds.push(website.id);

    const editor = await prisma.user.create({
      data: {
        email: `cms61-editor-${stamp}@test.local`,
        passwordHash: hashPassword("test-test-test"),
        name: "CMS-61 editor",
      },
    });
    createdUserIds.push(editor.id);
    await prisma.membership.create({
      data: { userId: editor.id, websiteId: website.id, role: "editor" },
    });

    const adminJwt = await signAccessToken({
      id: admin.id,
      email: admin.email,
      name: admin.name,
      websiteId: website.id,
      websiteName: website.name,
      role: "admin",
      siteKey: website.siteKey,
    });
    const editorJwt = await signAccessToken({
      id: editor.id,
      email: editor.email,
      name: editor.name,
      websiteId: website.id,
      websiteName: website.name,
      role: "editor",
      siteKey: website.siteKey,
    });

    const app = await appPromise;
    const put = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/ai/external-sources",
      headers: {
        authorization: `Bearer ${adminJwt}`,
        "content-type": "application/json",
      },
      payload: {
        sources: [
          {
            id: "src-prod",
            label: "Public MCP",
            url: "https://1.1.1.1/mcp",
            enabled: true,
            authHeaderValue: "Bearer super-secret-token",
          },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    const putBody = put.json() as {
      sources: Array<Record<string, unknown>>;
    };
    expect(putBody.sources[0]).toMatchObject({
      id: "src-prod",
      label: "Public MCP",
      url: "https://1.1.1.1/mcp",
      enabled: true,
      authConfigured: true,
    });
    expect(JSON.stringify(putBody)).not.toContain("super-secret-token");
    expect(putBody.sources[0]).not.toHaveProperty("authHeaderValue");

    const editorGet = await app.inject({
      method: "GET",
      url: "/api/v1/admin/ai/external-sources",
      headers: { authorization: `Bearer ${editorJwt}` },
    });
    expect(editorGet.statusCode).toBe(200);
    expect(JSON.stringify(editorGet.json())).not.toContain("super-secret-token");

    const editorPut = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/ai/external-sources",
      headers: {
        authorization: `Bearer ${editorJwt}`,
        "content-type": "application/json",
      },
      payload: { sources: [] },
    });
    expect(editorPut.statusCode).toBe(403);
  });
});
