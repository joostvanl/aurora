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

vi.mock("../lib/audit.js", () => ({
  recordAuditEvent: vi.fn(),
}));

import { resolveAiConfig } from "./config.js";
import { chatCompletion } from "./openai.js";
import { executeAiTool } from "./tools.js";
import { recordAuditEvent } from "../lib/audit.js";
import { runAiChat } from "./agent.js";
import type { AiToolAuditEvent } from "./tools.js";

const resolveConfig = resolveAiConfig as ReturnType<typeof vi.fn>;
const completion = chatCompletion as ReturnType<typeof vi.fn>;
const execTool = executeAiTool as ReturnType<typeof vi.fn>;
const audit = recordAuditEvent as ReturnType<typeof vi.fn>;

describe("runAiChat audit wiring", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resolveConfig.mockResolvedValue({
      enabled: true,
      apiKey: "k",
      baseUrl: "https://example.test/v1",
      model: "test-model",
      instructions: "",
    });
  });

  it("wires recordAudit with actorKind ai, source, and scheduled task ids", async () => {
    let captured:
      | ((event: AiToolAuditEvent) => Promise<void>)
      | undefined;

    execTool.mockImplementation(async (name, _args, ctx) => {
      captured = ctx.recordAudit;
      return { name, ok: true, summary: "ok" };
    });

    completion
      .mockResolvedValueOnce({
        model: "test-model",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "create_entry", arguments: "{}" },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        model: "test-model",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        message: { role: "assistant", content: "done", tool_calls: [] },
      });

    await runAiChat({
      message: "create",
      websiteId: "ws1",
      userId: "u1",
      role: "admin",
      source: "scheduled_task",
      scheduledTaskId: "task1",
      scheduledTaskRunId: "run1",
      context: { mode: "general" },
    });

    expect(captured).toBeTypeOf("function");
    await captured!({
      action: "entry.create",
      resourceType: "entry",
      resourceId: "e1",
      summary: "Created entry home",
      meta: { tool: "create_entry", contentTypeApiId: "page" },
    });

    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith({
      websiteId: "ws1",
      actorUserId: "u1",
      actorKind: "ai",
      action: "entry.create",
      resourceType: "entry",
      resourceId: "e1",
      summary: "Created entry home",
      meta: {
        tool: "create_entry",
        contentTypeApiId: "page",
        source: "scheduled_task",
        taskId: "task1",
        runId: "run1",
      },
    });
  });
});
