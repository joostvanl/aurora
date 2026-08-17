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
    expect(names).toContain("get_current_datetime");
  });

  it("includes publish tools when allowPublish is true", () => {
    const names = aiToolsForSource("scheduled_task", {
      allowPublish: true,
    }).map((t) => t.function.name);
    expect(names).toContain("publish_entry");
    expect(names).toContain("unpublish_entry");
    expect(names).not.toContain("list_forms");
    expect(names).not.toContain("create_content_type");
  });

  it("omits inspect tools from the scheduled_task tool list", () => {
    const names = aiToolsForSource("scheduled_task").map((t) => t.function.name);
    expect(names).not.toContain("list_scheduled_tasks");
    expect(names).not.toContain("get_scheduled_task");
    expect(names).not.toContain("list_scheduled_task_runs");
  });

  it("keeps publish tools for normal chat", () => {
    const names = aiToolsForSource("chat").map((t) => t.function.name);
    expect(names).toContain("publish_entry");
    expect(names).toContain("unpublish_entry");
    expect(names).toContain("list_forms");
    expect(names).toContain("list_scheduled_tasks");
  });

  it("lists blocked tool names", () => {
    expect(SCHEDULED_TASK_BLOCKED_TOOLS.has("publish_entry")).toBe(true);
    expect(SCHEDULED_TASK_BLOCKED_TOOLS.has("unpublish_entry")).toBe(true);
    expect(SCHEDULED_TASK_BLOCKED_TOOLS.has("restore_entry_version")).toBe(
      true,
    );
    expect(
      SCHEDULED_TASK_BLOCKED_TOOLS.has("restore_content_type_version"),
    ).toBe(true);
  });
});
