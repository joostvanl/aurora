import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({
  prisma: {
    entry: { findUnique: vi.fn() },
  },
}));

vi.mock("./config.js", () => ({
  resolveAiConfig: vi.fn(),
}));

vi.mock("./openai.js", () => ({
  chatCompletion: vi.fn(),
}));

vi.mock("./tools.js", () => ({
  aiToolsForSource: vi.fn(() => []),
  CONTENT_SCHEMA_TOOLS: new Set(),
  executeAiTool: vi.fn(),
}));

vi.mock("./entryEdit.js", () => ({
  runEntryContentEdit: vi.fn(),
}));

vi.mock("./websiteContext.js", () => ({
  buildWebsiteKnowledge: vi.fn(async () => ""),
}));

vi.mock("./frontendBrief.js", () => ({
  buildFrontendAgentBrief: vi.fn(),
  FRONTEND_BRIEF_HEADING: "## Frontend",
  mergeFrontendBrief: (reply: string) => reply,
  stripFrontendBrief: (reply: string) => reply,
  userConfirmedSchemaChange: () => false,
}));

vi.mock("./cmsLinks.js", () => ({
  ensureStudioMarkdownLinks: (reply: string) => reply,
}));

vi.mock("../lib/versions.js", () => ({
  createAiSnapshotGuard: () => async () => null,
}));

import { resolveAiConfig } from "./config.js";
import { chatCompletion } from "./openai.js";
import { executeAiTool } from "./tools.js";
import { runAiChat } from "./agent.js";

const resolveConfig = resolveAiConfig as ReturnType<typeof vi.fn>;
const completion = chatCompletion as ReturnType<typeof vi.fn>;
const execTool = executeAiTool as ReturnType<typeof vi.fn>;

describe("runAiChat caps", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolveConfig.mockResolvedValue({
      enabled: true,
      apiKey: "k",
      baseUrl: "https://example.test/v1",
      model: "test-model",
      instructions: "",
    });
    execTool.mockImplementation(async (name: string) => ({
      name,
      ok: true,
      summary: "ok",
    }));
  });

  it("stops with max_tool_calls and reports usage", async () => {
    completion.mockResolvedValueOnce({
      model: "test-model",
      usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10 },
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "list_entries", arguments: "{}" },
          },
          {
            id: "c2",
            type: "function",
            function: { name: "create_entry", arguments: "{}" },
          },
        ],
      },
    });

    const result = await runAiChat({
      message: "do stuff",
      websiteId: "ws1",
      userId: "u1",
      role: "admin",
      maxToolCalls: 1,
      context: { mode: "general" },
    });

    expect(result.stoppedReason).toBe("max_tool_calls");
    expect(result.usage?.toolCallCount).toBe(1);
    expect(result.usage?.uniqueToolCount).toBe(1);
    expect(result.usage?.totalTokens).toBe(10);
    expect(completion).toHaveBeenCalledTimes(1);
    expect(execTool).toHaveBeenCalledTimes(1);
  });

  it("stops with max_tokens after accumulating usage", async () => {
    completion.mockResolvedValueOnce({
      model: "test-model",
      usage: { promptTokens: 40, completionTokens: 60, totalTokens: 100 },
      message: {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "list_entries", arguments: "{}" },
          },
        ],
      },
    });

    const result = await runAiChat({
      message: "do stuff",
      websiteId: "ws1",
      userId: "u1",
      role: "admin",
      maxTokens: 50,
      context: { mode: "general" },
    });

    expect(result.stoppedReason).toBe("max_tokens");
    expect(result.usage?.totalTokens).toBe(100);
    expect(result.usage?.toolCallCount).toBe(1);
    expect(completion).toHaveBeenCalledTimes(1);
    expect(execTool).toHaveBeenCalledTimes(1);
  });
});
