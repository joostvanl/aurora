import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_AI_TOOL_RESULT_MAX_CHARS } from "./contextBudget.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("CMS-57 agent prompts (A1, A2, G2)", () => {
  const agent = readFileSync(join(here, "agent.ts"), "utf8");
  const tools = readFileSync(join(here, "tools.ts"), "utf8");
  const mcpPrompts = readFileSync(
    join(here, "../../../mcp/src/prompts.ts"),
    "utf8",
  );

  it("tells the model to re-read and not treat ok as success", () => {
    expect(agent).toMatch(/get_entry_field again/);
    expect(agent).toMatch(/ok:true is not the user goal/);
    expect(tools).toMatch(/ok:true is not user-goal success/);
  });

  it("prefers patch_json_field for JSON and forbids retry-storms", () => {
    expect(agent).toMatch(/prefer patch_json_field/);
    expect(agent).toMatch(/do not retry guessed anchors/);
    expect(mcpPrompts).toMatch(/do not retry guessed anchors/);
    expect(mcpPrompts).toMatch(/patch_json_field/);
  });

  it("keeps the default tool-result cap at 6000 (G2)", () => {
    expect(DEFAULT_AI_TOOL_RESULT_MAX_CHARS).toBe(6_000);
  });
});
