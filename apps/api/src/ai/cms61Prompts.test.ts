import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("CMS-61 prompt and docs (D2)", () => {
  const agent = readFileSync(join(here, "agent.ts"), "utf8");
  const docs = readFileSync(
    join(here, "../../../../docs/ai-external-sources.md"),
    "utf8",
  );
  const mcpDocs = readFileSync(join(here, "../../../../docs/mcp.md"), "utf8");

  it("describes MCP sources vs fetch_url and the draft article path", () => {
    expect(agent).toMatch(/External sources \(configured MCP — not fetch_url\)/);
    expect(agent).toMatch(/list_external_sources/);
    expect(agent).toMatch(/call_external_source/);
    expect(agent).toMatch(/create_entry as a draft/);
    expect(agent).toMatch(/do not invent ids, figures, or quotes/);
    expect(agent).toMatch(/dataTruncated/);
    expect(agent).toMatch(/There is no write_article_from_source tool/);
  });

  it("docs distinguish Studio-AI client from hosted /mcp", () => {
    expect(docs).toMatch(/in-app agent is an MCP/);
    expect(docs).toMatch(/\*\*client\*\*/);
    expect(docs).toMatch(/hosted MCP \*\*server\*\*/);
    expect(mcpDocs).toMatch(/ai-external-sources/);
    expect(docs).not.toMatch(/trc_|aur_u_[A-Za-z0-9]{8,}/);
  });
});
