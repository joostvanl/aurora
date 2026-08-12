import { describe, expect, it } from "vitest";
import { resolveToolDomains, toolDomain } from "./toolScope.js";
import { aiToolsForSource } from "./tools.js";

describe("toolScope", () => {
  it("maps tools to domains", () => {
    expect(toolDomain("get_entry")).toBe("core");
    expect(toolDomain("create_field")).toBe("schema");
    expect(toolDomain("list_forms")).toBe("forms");
  });

  it("keeps scheduled tasks on core only", () => {
    const domains = resolveToolDomains(undefined, "scheduled_task");
    expect([...domains]).toEqual(["core"]);
  });

  it("scopes entry screens to core", () => {
    const domains = resolveToolDomains({
      entryId: "e1",
      pathname: "/entries/page/e1",
    });
    expect(domains.has("core")).toBe(true);
    expect(domains.has("forms")).toBe(false);
    expect(domains.has("schema")).toBe(false);
  });

  it("scopes forms screens to core+forms", () => {
    const domains = resolveToolDomains({
      formApiId: "contact",
      pathname: "/forms/contact",
    });
    expect(domains.has("forms")).toBe(true);
    expect(domains.has("schema")).toBe(false);
  });

  it("scopes content-types to core+schema", () => {
    const domains = resolveToolDomains({ pathname: "/content-types/page" });
    expect(domains.has("schema")).toBe(true);
    expect(domains.has("forms")).toBe(false);
  });
});

describe("aiToolsForSource scoping", () => {
  it("omits forms and schema tools for scheduled_task", () => {
    const names = aiToolsForSource("scheduled_task").map((t) => t.function.name);
    expect(names).toContain("get_entry");
    expect(names).toContain("fetch_url");
    expect(names).not.toContain("list_forms");
    expect(names).not.toContain("create_content_type");
    expect(names).not.toContain("publish_entry");
  });

  it("omits schema tools for editor role", () => {
    const names = aiToolsForSource("chat", {
      role: "editor",
      context: { pathname: "/dashboard" },
    }).map((t) => t.function.name);
    expect(names).not.toContain("create_content_type");
    expect(names).toContain("list_forms");
    expect(names).toContain("get_entry");
  });

  it("entry focus drops forms/schema schemas from catalog", () => {
    const names = aiToolsForSource("chat", {
      role: "admin",
      context: { entryId: "e1", pathname: "/entries/page/e1" },
    }).map((t) => t.function.name);
    expect(names).toContain("str_replace");
    expect(names).not.toContain("list_forms");
    expect(names).not.toContain("create_field");
  });

  it("forms focus keeps form tools", () => {
    const names = aiToolsForSource("chat", {
      role: "admin",
      context: { formApiId: "contact", pathname: "/forms/contact" },
    }).map((t) => t.function.name);
    expect(names).toContain("list_form_submissions");
    expect(names).not.toContain("create_content_type");
  });
});
