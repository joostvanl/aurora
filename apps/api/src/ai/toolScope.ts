import type { AiChatContext } from "@cms/shared";

export type AiToolDomain = "core" | "schema" | "forms";

const SCHEMA_TOOL_NAMES = new Set([
  "create_content_type",
  "update_content_type",
  "delete_content_type",
  "create_field",
  "update_field",
  "delete_field",
  "list_content_type_versions",
  "restore_content_type_version",
]);

const FORMS_TOOL_NAMES = new Set([
  "list_forms",
  "get_form",
  "create_form",
  "update_form",
  "delete_form",
  "create_form_field",
  "update_form_field",
  "delete_form_field",
  "list_form_submissions",
  "get_form_submission",
  "form_submission_stats",
  "mark_form_submission_read",
  "delete_form_submission",
]);

export function toolDomain(name: string): AiToolDomain {
  if (SCHEMA_TOOL_NAMES.has(name)) return "schema";
  if (FORMS_TOOL_NAMES.has(name)) return "forms";
  return "core";
}

/**
 * Which tool domains to advertise for this turn.
 * Entry-focused and scheduled runs stay on core to cut schema/forms JSON.
 */
export function resolveToolDomains(
  context?: AiChatContext,
  source?: string,
): Set<AiToolDomain> {
  const domains = new Set<AiToolDomain>(["core"]);
  const path = `${context?.pathname ?? ""} ${context?.page ?? ""}`.toLowerCase();

  if (source === "scheduled_task") {
    return domains;
  }

  if (
    context?.formApiId ||
    path.includes("/forms") ||
    /\bforms?\b/.test(path)
  ) {
    domains.add("forms");
    return domains;
  }

  if (path.includes("/content-types") || path.includes("content type")) {
    domains.add("schema");
    return domains;
  }

  if (
    context?.entryId ||
    path.includes("/entries") ||
    /\bentr(y|ies)\b/.test(path)
  ) {
    return domains;
  }

  // General / unknown studio screens: core + forms + schema (role filter applied separately).
  domains.add("forms");
  domains.add("schema");
  return domains;
}
