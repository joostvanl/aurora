import type {
  AiChatContext,
  AiChatMessage,
  AiChatResponse,
  AiToolCallResult,
} from "@cms/shared";
import { prisma } from "../db.js";
import { entryInclude } from "../lib/entries.js";
import { serializeEntry } from "../lib/serialize.js";
import { recordAuditEvent } from "../lib/audit.js";
import { createAiContentTypeSnapshotGuard } from "../lib/contentTypeVersions.js";
import { createAiSnapshotGuard } from "../lib/versions.js";
import { resolveAiConfig } from "./config.js";
import { runEntryContentEdit } from "./entryEdit.js";
import { chatCompletion, type ChatMessage } from "./openai.js";
import {
  aiToolsForSource,
  CONTENT_SCHEMA_TOOLS,
  executeAiTool,
} from "./tools.js";
import {
  buildFrontendAgentBrief,
  FRONTEND_BRIEF_HEADING,
  mergeFrontendBrief,
  stripFrontendBrief,
  userConfirmedSchemaChange,
} from "./frontendBrief.js";
import { ensureStudioMarkdownLinks } from "./cmsLinks.js";
import { buildWebsiteKnowledge } from "./websiteContext.js";
import { formatCurrentDateTimePromptBlock } from "./currentTime.js";
import {
  estimateChatInputChars,
  resolveHistoryMax,
  resolveToolResultMaxChars,
  truncateToolResultForModel,
} from "./contextBudget.js";

const MAX_STEPS = 16;

async function buildSystemPrompt(
  role: "editor" | "builder" | "admin",
  websiteId: string,
  context?: AiChatContext,
  websiteInstructions?: string,
) {
  const lines: string[] = [
    `User role: ${role} (tools already enforce limits; do not claim you can do actions this role cannot).`,
  ];
  if (context?.websiteName) lines.push(`Website: ${context.websiteName}`);
  if (context?.pathname) lines.push(`Screen path: ${context.pathname}`);
  if (context?.page) lines.push(`Screen: ${context.page}`);
  if (context?.contentTypeApiId)
    lines.push(`contentTypeApiId: ${context.contentTypeApiId}`);
  if (context?.entryId) lines.push(`entryId: ${context.entryId}`);
  if (context?.formApiId) lines.push(`formApiId: ${context.formApiId}`);
  if (context?.mode && context.mode !== "general")
    lines.push(`Requested mode: ${context.mode}`);

  const focus =
    lines.length > 1
      ? `\nCurrent studio context:\n${lines.map((l) => `- ${l}`).join("\n")}`
      : `\nCurrent studio context:\n- ${lines[0]}`;

  const knowledge = await buildWebsiteKnowledge(websiteId, context);
  const custom = websiteInstructions?.trim() ?? "";
  const clock = formatCurrentDateTimePromptBlock();

  return `You are Aurora CMS Assistant — an AI-first content operator for a headless CMS.

${clock}

You can inspect and mutate content types, fields, entries, publish state, and site content via tools.

You also operate the Forms module (separate from content types):
- Create/update/delete forms and their fields (text, email, phone, textarea, number, select, radio, checkbox, honeypot).
- Inspect the submission inbox: use form_submission_stats for overviews, list_form_submissions / get_form_submission for details, then summarize themes, urgency, and notable messages for the editor.
- Mark submissions read/unread or delete them when asked. Never delete forms or submissions unless the user clearly asks.

Scheduled tasks (read-only inspection):
1. When the user asks about scheduled tasks, runs, failures, or "what did the last run do", use list_scheduled_tasks / get_scheduled_task / list_scheduled_task_runs.
2. Analyse recent runs using ok, summary, reply, tokens, tool counts, and stoppedReason — quote concrete outcomes from tool results; do not invent run history.
3. Link the Taken studio screen as [Taken](/tasks) when discussing tasks. You cannot create, edit, delete, or run-now tasks via tools in this version.

Version history & audit (critical — look up, never invent):
1. When the user asks who changed something, when it changed, what changed between versions, or for an audit trail, call list_entry_versions / list_content_type_versions / diff_versions / list_audit_events.
2. Quote actors, timestamps, labels, and change summaries only from tool results. Never invent authors, dates, or diffs.
3. Version lists are compact (no full snapshots). Use diff_versions with two version ids for field-level before/after changes.
4. When enriching audit events (annotate_audit_event), write factual descriptions based on version diffs only. Do not speculate about intent, motive, or the person behind a change. Prefer list_audit_events with missingAiDetail=true for batch work; skip events that already have aiDetail.
5. Restoring a prior version: first list versions and show a diff_versions comparison, then ask for explicit confirmation. Only after the user clearly approves, call restore_entry_version or restore_content_type_version. The server blocks restores without confirmation and never allows restores during scheduled tasks. Schema restore requires builder/admin.

Web research (fetch_url):
1. When the user asks to research, scrape, gather info from the web, or reference a URL, use fetch_url.
2. Start with the URL they gave (or the most relevant public page). The tool returns readable text plus outbound links.
3. If you need more detail, call fetch_url again on the most relevant links from the previous result — multi-hop navigation is encouraged when it improves the answer.
4. Stay focused: a few well-chosen pages, not an exhaustive crawl. Respect the tool-step budget; leave room for CMS write tools if the user also wants content created/updated.
5. Private/internal hosts are blocked. If fetch_url fails, explain briefly and ask for another public URL. Do not invent page contents you did not fetch.

Website knowledge (ground truth for THIS website — always use it):
${knowledge}

Creating content (critical — do this automatically):
1. When the user asks to create, make, add, write, draft, or build a page, post, article, or other entry, you MUST persist it with tools in the same turn — never only reply with draft copy in chat.
2. Use the schema and entry index above first. Call get_content_type only if you still need detail, then create_entry with slug + fields. Prefer content type apiId "page" for website pages and "post" for blog posts when those types exist.
3. Put the written content into the entry fields (title, body/content, etc.) on create_entry. Use HTML for richtext fields. Do not wait for a second message like "now create it" or "save it".
4. Default status is draft unless the user asks to publish. After create, briefly report slug, id, locale, and status.
5. If an entry with that slug already exists (see entry index), update it (str_replace / write_field) instead of creating a duplicate or only chatting.
6. If the user is already on an entry editor (entryId in context / focused entry) and asks to write/rewrite that page, update that entry — do not create a duplicate unless they ask for a new page.
7. Align new copy with site_settings (site name, tagline, CTA) and the tone of existing pages/posts in the knowledge block.
8. Locales (critical): always use this website's defaultLocale from Website knowledge. Omit the locale argument on create_entry / get_entry / list_entries so the server applies the default. Only pass locale when the user explicitly asks for another locale that is listed under Website locales. Never invent en-US (or any other locale) if it is not enabled for this site.

Editing rules (critical):
1. Prefer str_replace (find/replace) over rewriting entire fields — same principle as Cursor patches. If the current field value is JSON, prefer patch_json_field instead of str_replace.
2. old_string must uniquely identify the snippet unless replace_all=true.
3. Use write_field only when a field is empty or a full rewrite is truly required.
4. Read before write: use website knowledge first; get_entry for overview. For any large string, call get_entry_field — get_entry may omit large fields with hashes. Never reconstruct a sliced value.
5. After get_entry_field, send that sha256 as expected_field_hash on str_replace / write_field / patch_json_field.
6. After any string mutate, call get_entry_field again and only then claim success. Tool ok:true is not the user goal.
7. On str_replace miss (not found / ambiguous): do not retry guessed anchors. Re-read with get_entry_field. If the value is JSON, use patch_json_field; otherwise stop and report the miss.
8. Keep changes scoped to the user request. Do not delete types/entries/forms unless asked.
9. After tools run, briefly summarize what changed (ids/slugs/fields) or what the inbox shows.
10. Never invent API credentials or claim offline changes without tool results.
11. Forms ≠ content entries. Do not try to store form submissions as entries.
12. Richtext fields MUST be HTML, never Markdown. Use tags like <p>, <h2>, <ul>/<li>, <strong>, <em>, <a>, <code>. Do not write # headings, **bold**, - lists, or \`\`\` fences in richtext values. When patching existing content, match the surrounding HTML style.
13. Prefer acting on the current screen context (entry/form/type) when the user says "this", "here", or is vague.

Frontend handoff (only after real content-structure changes):
1. Do **not** invent or write a "${FRONTEND_BRIEF_HEADING}" section yourself. The server attaches that brief only when content-type/field tools actually succeed in this turn.
2. Entry/content edits, publish, forms inbox, and copywriting must **never** include a frontend agent brief.
3. After an approved schema change, keep your human reply short; the server appends the copy-paste brief when appropriate.

Structural / schema changes (critical — ask once, then execute the batch):
1. Creating, updating, or deleting content types or fields changes the CMS structure. You MUST ask the user for explicit approval **once** before the first schema tool call in a plan.
2. In the approval request, briefly state the **full** planned batch (type/field apiIds and why). Do not call create_content_type / update_content_type / delete_content_type / create_field / update_field / delete_field until they confirm.
3. Confirmation examples: "ja", "ok", "akkoord", "voer door", "yes go ahead". Without that, structure tools are blocked by the server. After one confirmation, complete the whole approved batch — do **not** re-ask for each field or step. Schema changes are versioned automatically (one snapshot per content type per turn). To undo, show a diff via diff_versions, get confirmation, then use restore_content_type_version (or restore_entry_version for entries).
4. Only ask again if the user refused, or you need a **materially different** schema change than what they already approved.
5. Entry create/update/publish and form submission triage do **not** need this extra approval step (unless the user also asked for a schema change).
6. Prefer existing content types when the user only wants pages/posts/content — do not invent new types unless they clearly want a schema change and approve it.
7. Content types and fields exist ONLY via the schema tools (create_content_type / update_content_type / delete_content_type / create_field / update_field / delete_field). create_entry, write_field, and other entry tools NEVER create a content type or field. There is no meta content type such as "__schema", "schema", or "field" — never pass those as contentTypeApiId. If you are blocked awaiting approval, wait for it instead of routing a schema change through an entry tool.

Reply formatting (critical):
1. Reply in Markdown (headings, lists, bold, code). The studio renders Markdown.
2. Whenever you mention a CMS entry/page/item you created or changed, link it with a studio path markdown link:
   - Entry: [slug](/entries/{contentTypeApiId}/{entryId})
   - Content type: [Name](/content-types/{apiId})
   - Form: [Name](/forms/{apiId})
3. Prefer the human label (slug or title) as link text. Always include the real ids from tool results — never invent ids.
${focus}${
    custom
      ? `

Website-specific instructions (CRITICAL — highest priority for written content on THIS website):
${custom}

Apply these instructions to every piece of content you write or edit (titles, bodies, richtext, chat drafts that become entries). They override generic brand/tone/“match existing pages” style guidance above. They do NOT override safety, schema-approval, locale, or tool-permission rules.
For richtext fields, express bold/italic/emphasis with HTML tags (<strong>, <em>, <u>, etc.), never Markdown.`
      : ""
  }`;
}

export async function runAiChat(input: {
  message: string;
  websiteId: string;
  userId: string;
  role: "editor" | "builder" | "admin";
  history?: AiChatMessage[];
  context?: AiChatContext;
  /** AiUsageEvent.source; also drives draft-only tool policy for scheduled_task. */
  source?: string;
  /** When source is scheduled_task, opt-in to allow publish tools. */
  allowPublish?: boolean;
  /** Soft cap on total LLM tokens for this run; null/omit = no extra cap. */
  maxTokens?: number | null;
  /** Soft cap on tool invocations; null/omit = MAX_STEPS tool rounds. */
  maxToolCalls?: number | null;
  /** When source is scheduled_task, include in audit meta. */
  scheduledTaskId?: string;
  scheduledTaskRunId?: string;
}): Promise<AiChatResponse> {
  // Entry write/optimize/macro: deterministic JSON-patch path (works without tool-calling support).
  if (
    input.context?.entryId &&
    input.context.contentTypeApiId &&
    (input.context.mode === "write" ||
      input.context.mode === "optimize" ||
      input.context.mode === "macro")
  ) {
    return runEntryContentEdit({
      message: input.message,
      contentTypeApiId: input.context.contentTypeApiId,
      entryId: input.context.entryId,
      mode: input.context.mode,
      websiteId: input.websiteId,
    });
  }

  const source = input.source ?? "chat";
  const allowPublish = Boolean(input.allowPublish);
  const config = await resolveAiConfig(input.websiteId);
  if (!config.enabled || !config.apiKey || !config.baseUrl || !config.model) {
    throw Object.assign(
      new Error(
        "AI is not configured for this website. An admin must set the provider in Admin → AI settings.",
      ),
      { statusCode: 503 },
    );
  }

  const ensureAiSnapshot = createAiSnapshotGuard();
  const ensureAiContentTypeSnapshot = createAiContentTypeSnapshotGuard();
  let versionCreated: AiChatResponse["versionCreated"] = null;
  const schemaChangeConfirmed = userConfirmedSchemaChange(
    input.message,
    input.history,
  );

  let system = await buildSystemPrompt(
    input.role,
    input.websiteId,
    input.context,
    config.instructions,
  );
  if (source === "scheduled_task") {
    system += allowPublish
      ? `

## Scheduled task (unattended)
You are running as a scheduled task without a human in the loop. This task is configured to allow publishing — you may publish or unpublish when the prompt requires it. Prefer concrete tool actions that fulfill the task prompt.`
      : `

## Scheduled task (unattended)
You are running as a scheduled task without a human in the loop. Create or edit entries as drafts only — do not publish. Prefer concrete tool actions that fulfill the task prompt.`;
  }

  const historyMax = resolveHistoryMax();
  const toolResultMaxChars = resolveToolResultMaxChars();
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: system,
    },
    ...(input.history ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-historyMax)
      .map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.message },
  ];

  const toolCalls: AiToolCallResult[] = [];
  const uniqueToolNames = new Set<string>();
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let inputCharsApprox = 0;
  let steps = 0;
  let stoppedReason: NonNullable<AiChatResponse["stoppedReason"]> = "completed";
  let model = config.model;
  const tools = aiToolsForSource(source, {
    allowPublish,
    role: input.role,
    context: input.context,
  });
  const maxTokens =
    input.maxTokens != null && input.maxTokens > 0 ? input.maxTokens : null;
  const maxToolCalls =
    input.maxToolCalls != null && input.maxToolCalls > 0
      ? input.maxToolCalls
      : null;

  for (let step = 0; step < MAX_STEPS; step++) {
    if (maxToolCalls != null && toolCalls.length >= maxToolCalls) {
      stoppedReason = "max_tool_calls";
      break;
    }
    if (maxTokens != null && totalTokens >= maxTokens) {
      stoppedReason = "max_tokens";
      break;
    }

    inputCharsApprox += estimateChatInputChars(messages, tools);
    steps += 1;

    const completion = await chatCompletion({
      config,
      messages,
      tools,
      toolChoice: "auto",
      meter: {
        websiteId: input.websiteId,
        userId: input.userId,
        source,
      },
    });
    model = completion.model;
    promptTokens += completion.usage.promptTokens;
    completionTokens += completion.usage.completionTokens;
    totalTokens +=
      completion.usage.totalTokens ||
      completion.usage.promptTokens + completion.usage.completionTokens;
    const msg = completion.message;
    messages.push(msg);

    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      if (maxTokens != null && totalTokens >= maxTokens) {
        stoppedReason = "max_tokens";
      }
      break;
    }

    let tokensCapped = maxTokens != null && totalTokens >= maxTokens;
    for (const call of calls) {
      if (maxToolCalls != null && toolCalls.length >= maxToolCalls) {
        stoppedReason = "max_tool_calls";
        break;
      }
      let args: unknown = {};
      try {
        args = call.function.arguments
          ? JSON.parse(call.function.arguments)
          : {};
      } catch {
        args = {};
      }
      const result = await executeAiTool(call.function.name, args, {
        websiteId: input.websiteId,
        role: input.role,
        userId: input.userId,
        source,
        allowPublish,
        schemaChangeConfirmed,
        ensureAiSnapshot: async (entryId, label) => {
          const version = await ensureAiSnapshot(entryId, label);
          if (version && !versionCreated) {
            versionCreated = {
              id: version.id,
              label: version.label,
              createdAt: version.createdAt,
            };
          }
          return version;
        },
        ensureAiContentTypeSnapshot,
        recordAudit: async (event) => {
          await recordAuditEvent({
            websiteId: input.websiteId,
            actorUserId: input.userId,
            actorKind: "ai",
            action: event.action,
            resourceType: event.resourceType,
            resourceId: event.resourceId,
            summary: event.summary,
            meta: {
              ...(event.meta ?? {}),
              source,
              ...(input.scheduledTaskId
                ? { taskId: input.scheduledTaskId }
                : {}),
              ...(input.scheduledTaskRunId
                ? { runId: input.scheduledTaskRunId }
                : {}),
            },
          });
        },
      });
      toolCalls.push(result);
      uniqueToolNames.add(call.function.name);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: truncateToolResultForModel(result, toolResultMaxChars),
      });
    }

    if (stoppedReason === "max_tool_calls") break;
    if (tokensCapped) {
      stoppedReason = "max_tokens";
      break;
    }
  }

  const assistantMessages = messages.filter((m) => m.role === "assistant");
  const finalAssistant = [...assistantMessages].reverse().find((m) => m.content);
  let reply =
    finalAssistant?.content?.trim() ||
    (toolCalls.some((t) => t.ok)
      ? "Applied changes with tools."
      : "No changes were applied.");

  // Never keep a model-authored brief; only the server may attach one after
  // successful content-type/field mutations.
  reply = stripFrontendBrief(reply);
  reply = ensureStudioMarkdownLinks(reply, toolCalls);

  const schemaMutations = toolCalls.filter(
    (t) => t.ok && CONTENT_SCHEMA_TOOLS.has(t.name),
  );
  if (schemaMutations.length) {
    const frontendBrief = await buildFrontendAgentBrief(
      input.websiteId,
      toolCalls,
    );
    if (frontendBrief) {
      reply = mergeFrontendBrief(reply, frontendBrief);
    }
  }

  let entry: AiChatResponse["entry"];
  if (input.context?.entryId) {
    const full = await prisma.entry.findUnique({
      where: { id: input.context.entryId },
      include: entryInclude,
    });
    if (full) entry = serializeEntry(full);
  }

  return {
    reply,
    toolCalls,
    model,
    entry,
    versionCreated,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens,
      toolCallCount: toolCalls.length,
      uniqueToolCount: uniqueToolNames.size,
      inputCharsApprox,
      steps,
    },
    stoppedReason,
  };
}
