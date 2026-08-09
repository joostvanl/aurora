import { describe, expect, it } from "vitest";
import {
  aiToolsForSource,
  SCHEDULED_TASK_BLOCKED_TOOLS,
} from "./tools.js";

describe("scheduled_task tool policy", () => {
  it("omits publish/unpublish from the tool list by default", () => {
    const names = aiToolsForSource("scheduled_task").map((t) => t.function.name);
    expect(names).not.toContain("publish_entry");
    expect(names).not.toContain("unpublish_entry");
    expect(names).toContain("create_entry");
    expect(names).toContain("fetch_url");
  });

  it("includes publish tools when allowPublish is true", () => {
    const names = aiToolsForSource("scheduled_task", {
      allowPublish: true,
    }).map((t) => t.function.name);
    expect(names).toContain("publish_entry");
    expect(names).toContain("unpublish_entry");
  });

  it("keeps publish tools for normal chat", () => {
    const names = aiToolsForSource("chat").map((t) => t.function.name);
    expect(names).toContain("publish_entry");
    expect(names).toContain("unpublish_entry");
  });

  it("lists blocked tool names", () => {
    expect(SCHEDULED_TASK_BLOCKED_TOOLS.has("publish_entry")).toBe(true);
    expect(SCHEDULED_TASK_BLOCKED_TOOLS.has("unpublish_entry")).toBe(true);
  });
});
