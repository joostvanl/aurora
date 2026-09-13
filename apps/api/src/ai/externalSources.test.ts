import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({
  prisma: {
    setting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "../db.js";
import {
  EXTERNAL_SOURCES_KEY,
  listEnabledSources,
  listPublicSources,
  replaceExternalSources,
} from "./externalSources.js";

const findUnique = prisma.setting.findUnique as ReturnType<typeof vi.fn>;
const upsert = prisma.setting.upsert as ReturnType<typeof vi.fn>;
const deleteMany = prisma.setting.deleteMany as ReturnType<typeof vi.fn>;

const WEBSITE = "ws-cms61-a";

function storedRow(sources: unknown) {
  return { value: JSON.stringify(sources) };
}

describe("external sources settings (CMS-61 C2–C5, C8)", () => {
  beforeEach(() => {
    findUnique.mockReset();
    upsert.mockReset();
    deleteMany.mockReset();
    upsert.mockResolvedValue({});
    deleteMany.mockResolvedValue({ count: 0 });
  });

  it("C2: omitting authHeaderValue keeps the existing secret", async () => {
    findUnique.mockResolvedValue(
      storedRow([
        {
          id: "src-1",
          label: "Trace",
          type: "mcp_http",
          url: "https://1.1.1.1/mcp",
          enabled: true,
          authHeaderName: "Authorization",
          authHeaderValue: "Bearer secret-token-value",
        },
      ]),
    );

    const result = await replaceExternalSources(WEBSITE, {
      sources: [
        {
          id: "src-1",
          label: "Trace",
          url: "https://1.1.1.1/mcp",
          enabled: true,
        },
      ],
    });

    expect(result.sources[0]?.authConfigured).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret-token-value");
    const saved = JSON.parse(upsert.mock.calls[0][0].update.value) as Array<{
      authHeaderValue?: string;
    }>;
    expect(saved[0]?.authHeaderValue).toBe("Bearer secret-token-value");
  });

  it("C3: clearAuth drops the stored secret", async () => {
    findUnique.mockResolvedValue(
      storedRow([
        {
          id: "src-1",
          label: "Trace",
          type: "mcp_http",
          url: "https://1.1.1.1/mcp",
          enabled: true,
          authHeaderName: "Authorization",
          authHeaderValue: "Bearer secret-token-value",
        },
      ]),
    );

    const result = await replaceExternalSources(WEBSITE, {
      sources: [
        {
          id: "src-1",
          label: "Trace",
          url: "https://1.1.1.1/mcp",
          enabled: true,
          clearAuth: true,
        },
      ],
    });

    expect(result.sources[0]?.authConfigured).toBe(false);
    expect(result.sources[0]?.authPreview).toBeNull();
    const saved = JSON.parse(upsert.mock.calls[0][0].update.value) as Array<{
      authHeaderValue?: string;
    }>;
    expect(saved[0]?.authHeaderValue).toBeUndefined();
  });

  it("C4: a 9th source is rejected", async () => {
    findUnique.mockResolvedValue(null);
    const sources = Array.from({ length: 9 }, (_, i) => ({
      label: `S${i}`,
      url: "https://1.1.1.1/mcp",
      enabled: true,
    }));
    await expect(replaceExternalSources(WEBSITE, { sources })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("C5: private/localhost URLs are rejected", async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      replaceExternalSources(WEBSITE, {
        sources: [{ label: "loop", url: "http://127.0.0.1:9", enabled: true }],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      replaceExternalSources(WEBSITE, {
        sources: [{ label: "lan", url: "http://10.0.0.1/", enabled: true }],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("C8: disabled sources stay on GET and drop out of listEnabledSources", async () => {
    const rows = [
      {
        id: "on",
        label: "On",
        type: "mcp_http",
        url: "https://1.1.1.1/on",
        enabled: true,
        authHeaderName: "Authorization",
        authHeaderValue: "secret",
      },
      {
        id: "off",
        label: "Off",
        type: "mcp_http",
        url: "https://1.1.1.1/off",
        enabled: false,
        authHeaderName: "Authorization",
      },
    ];
    findUnique.mockResolvedValue(storedRow(rows));

    const pub = await listPublicSources(WEBSITE);
    expect(pub.sources.map((s) => s.id)).toEqual(["on", "off"]);
    expect(pub.sources.some((s) => "authHeaderValue" in s)).toBe(false);
    expect(JSON.stringify(pub)).not.toContain("secret");

    const enabled = await listEnabledSources(WEBSITE);
    expect(enabled.map((s) => s.id)).toEqual(["on"]);
  });

  it("writes the Setting key ai.externalSources", async () => {
    findUnique.mockResolvedValue(null);
    await replaceExternalSources(WEBSITE, {
      sources: [
        {
          label: "Public MCP",
          url: "https://1.1.1.1/mcp",
          enabled: true,
          authHeaderValue: "Bearer abcdefghijklmnop",
        },
      ],
    });
    expect(upsert.mock.calls[0][0].where.websiteId_key.key).toBe(
      EXTERNAL_SOURCES_KEY,
    );
  });
});
