import type {
  AiChatContext,
  AiChatMessage,
  AiChatResponse,
  AiToolCallResult,
} from "@cms/shared";
import { prisma } from "../db.js";
import { entryInclude } from "../lib/entries.js";
import { serializeEntry } from "../lib/serialize.js";
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

  return `You are Aurora CMS Assistant — an AI-first content operator for a headless CMS.

You can inspect and mutate content types, fields, entries, publish state, and site content via tools.

You also operate the Forms module (separate from content types):
- Create/update/delete forms and their fields (text, email, phone, textarea, number, select, radio, checkbox, honeypot).
- Inspect the submission inbox: use form_submission_stats for overviews, list_form_submissions / get_form_submission for details, then summarize themes, urgency, and notable messages for the editor.
- Mark submissions read/unread or delete them when asked. Never delete forms or submissions unless the user clearly asks.

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
1. Prefer str_replace (find/replace) over rewriting entire fields — same principle as Cursor patches.
2. old_string must uniquely identify the snippet unless replace_all=true.
3. Use write_field only when a field is empty or a full rewrite is truly required.
4. Read before write: use website knowledge first; get_entry / get_content_type / get_form when you need fresher or fuller data.
5. Keep changes scoped to the user request. Do not delete types/entries/forms unless asked.
6. After tools run, briefly summarize what changed (ids/slugs/fields) or what the inbox shows.
7. Never invent API credentials or claim offline changes without tool results.
8. Forms ≠ content entries. Do not try to store form submissions as entries.
9. Richtext fields MUST be HTML, never Markdown. Use tags like <p>, <h2>, <ul>/<li>, <strong>, <em>, <a>, <code>. Do not write # headings, **bold**, - lists, or \`\`\` fences in richtext values. When patching existing content, match the surrounding HTML style.
10. Prefer acting on the current screen context (entry/form/type) when the user says "this", "here", or is vague.

Frontend handoff (only after real content-structure changes):
1. Do **not** invent or write a "${FRONTEND_BRIEF_HEADING}" section yourself. The server attaches that brief only when content-type/field tools actually succeed in this turn.
2. Entry/content edits, publish, forms inbox, and copywriting must **never** include a frontend agent brief.
3. After an approved schema change, keep your human reply short; the server appends the copy-paste brief when appropriate.

Structural / schema changes (critical — ask first):
1. Creating, updating, or deleting content types or fields changes the CMS structure. You MUST ask the user for explicit approval and wait for their confirmation before calling those tools.
2. In the approval request, briefly state what you plan to change (type/field apiIds and why). Do not call create_content_type / update_content_type / delete_content_type / create_field / update_field / delete_field until they confirm.
3. Confirmation examples: "ja", "ok", "akkoord", "voer door", "yes go ahead". Without that, structure tools are blocked by the server.
4. Entry create/update/publish and form submission triage do **not** need this extra approval step (unless the user also asked for a schema change).
5. Prefer existing content types when the user only wants pages/posts/content — do not invent new types unless they clearly want a schema change and approve it.

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
  let versionCreated: AiChatResponse["versionCreated"] = null;
  const schemaChangeConfirmed = userConfirmedSchemaChange(input.message);

  let system = await buildSystemPrompt(
    input.role,
    input.websiteId,
    input.context,
    config.instructions,
  );
  if (source === "scheduled_task") {
    system += `

## Scheduled task (unattended)
You are running as a scheduled task without a human in the loop. Create or edit entries as drafts only — do not publish. Prefer concrete tool actions that fulfill the task prompt.`;
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: system,
    },
    ...(input.history ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.message },
  ];

  const toolCalls: AiToolCallResult[] = [];
  let model = config.model;
  const tools = aiToolsForSource(source);

  for (let step = 0; step < MAX_STEPS; step++) {
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
    const msg = completion.message;
    messages.push(msg);

    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      break;
    }

    for (const call of calls) {
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
      });
      toolCalls.push(result);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
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
  };
}
