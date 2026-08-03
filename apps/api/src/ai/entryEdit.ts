import type { AiChatResponse, AiToolCallResult } from "@cms/shared";
import { prisma } from "../db.js";
import { entryInclude, getContentTypeOrThrow, setEntryFields } from "../lib/entries.js";
import { serializeEntry } from "../lib/serialize.js";
import { createEntryVersion } from "../lib/versions.js";
import { applyStrReplace } from "./patches.js";
import { resolveAiConfig, type ResolvedAiConfig } from "./config.js";
import { chatCompletion } from "./openai.js";
import { buildWebsiteKnowledge } from "./websiteContext.js";

type PatchOp =
  | {
      fieldApiId: string;
      op: "str_replace";
      old_string: string;
      new_string: string;
      replace_all?: boolean;
    }
  | {
      fieldApiId: string;
      op: "write";
      value: unknown;
    };

type PatchPlan = {
  summary?: string;
  patches: PatchOp[];
};

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return JSON.parse(fenced[1].trim());
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }

  throw new Error("Model did not return valid JSON patches");
}

function parsePlan(raw: unknown): PatchPlan {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Invalid patch plan");
  }
  const obj = raw as Record<string, unknown>;
  const patchesRaw = obj.patches;
  if (!Array.isArray(patchesRaw)) {
    throw new Error("Patch plan missing patches array");
  }

  const patches: PatchOp[] = [];
  for (const item of patchesRaw) {
    if (typeof item !== "object" || item === null) continue;
    const p = item as Record<string, unknown>;
    const fieldApiId = typeof p.fieldApiId === "string" ? p.fieldApiId : "";
    const op = p.op;
    if (!fieldApiId) continue;

    if (op === "str_replace") {
      if (typeof p.old_string !== "string" || typeof p.new_string !== "string") {
        continue;
      }
      patches.push({
        fieldApiId,
        op: "str_replace",
        old_string: p.old_string,
        new_string: p.new_string,
        replace_all: Boolean(p.replace_all),
      });
    } else if (op === "write") {
      patches.push({
        fieldApiId,
        op: "write",
        value: p.value,
      });
    }
  }

  return {
    summary: typeof obj.summary === "string" ? obj.summary : undefined,
    patches,
  };
}

async function requestPatchPlan(options: {
  config: ResolvedAiConfig;
  mode: "write" | "optimize";
  instruction: string;
  contentTypeApiId: string;
  websiteId: string;
  entry: {
    id: string;
    slug: string;
    fields: Record<string, unknown>;
    fieldDefs: Array<{ apiId: string; name: string; type: string }>;
  };
  websiteContext: string;
}) {
  const editable = options.entry.fieldDefs.filter((f) => f.apiId !== "slug");
  const currentFields: Record<string, unknown> = {};
  for (const f of editable) {
    currentFields[f.apiId] = options.entry.fields[f.apiId] ?? "";
  }

  const custom = options.config.instructions?.trim() ?? "";

  const baseSystem =
    options.mode === "optimize"
      ? `You optimize CMS entry field values.
Return ONLY valid JSON (no markdown) with this shape:
{"summary":"short note","patches":[...]}

Patch ops:
- {"fieldApiId":"...","op":"str_replace","old_string":"...","new_string":"...","replace_all":false}
- {"fieldApiId":"...","op":"write","value":"..."}  (only if a full rewrite is necessary)

Rules:
- Prefer str_replace with the smallest unique old_string.
- old_string must exist exactly in the current field value.
- Do not invent fields. Only use provided fieldApiIds.
- Improve clarity/SEO/tone while preserving meaning.
- Match the website brand/voice from the provided website context.
- Richtext fields (type "richtext") MUST be HTML, never Markdown. Use <p>, <h2>, <ul>/<li>, <strong>, <em>, <a>, <code>. Never use # headings, **bold**, - lists, or fenced code in richtext values. Preserve existing HTML structure when patching.
- If nothing should change, return {"summary":"No changes","patches":[]}`
      : `You write CMS entry field values.
Return ONLY valid JSON (no markdown) with this shape:
{"summary":"short note","patches":[...]}

Patch ops:
- {"fieldApiId":"...","op":"write","value":"..."} for empty/weak fields
- {"fieldApiId":"...","op":"str_replace","old_string":"...","new_string":"..."} for small edits

Rules:
- Fill empty string fields with useful content.
- Do not invent fields. Only use provided fieldApiIds.
- Keep brand voice clear and concrete; match the website context (site name, tagline, existing pages).
- Richtext fields (type "richtext") MUST be HTML, never Markdown. Use <p>, <h2>, <ul>/<li>, <strong>, <em>, <a>, <code>. Never use # headings, **bold**, - lists, or fenced code in richtext values.
- If nothing should change, return {"summary":"No changes","patches":[]}`;

  const system =
    baseSystem +
    (custom
      ? `

Website-specific instructions (CRITICAL — highest priority for written field values):
${custom}

Apply these to every field value you write or patch. They override generic brand/tone matching above. For richtext, use HTML <strong>/<em> (not Markdown) when bold/italic is required.`
      : "");

  const user = JSON.stringify(
    {
      instruction: options.instruction,
      contentTypeApiId: options.contentTypeApiId,
      entryId: options.entry.id,
      slug: options.entry.slug,
      fields: editable,
      currentValues: currentFields,
      websiteContext: options.websiteContext,
    },
    null,
    2,
  );

  const completion = await chatCompletion({
    config: options.config,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    responseFormatJson: true,
    meter: {
      websiteId: options.websiteId,
      source: options.mode === "optimize" ? "entry_optimize" : "entry_write",
    },
  });

  const content = completion.message.content ?? "";
  const plan = parsePlan(extractJsonObject(content));
  return { plan, model: completion.model };
}

export async function runEntryContentEdit(input: {
  message: string;
  contentTypeApiId: string;
  entryId: string;
  mode: "write" | "optimize";
  websiteId: string;
}): Promise<AiChatResponse> {
  const config = await resolveAiConfig(input.websiteId);
  if (!config.enabled || !config.apiKey || !config.baseUrl || !config.model) {
    throw Object.assign(
      new Error(
        "AI is not configured for this website. An admin must set the provider in Admin → AI.",
      ),
      { statusCode: 503 },
    );
  }

  const contentType = await getContentTypeOrThrow(
    input.contentTypeApiId,
    input.websiteId,
  );

  const entry = await prisma.entry.findFirst({
    where: { id: input.entryId, contentTypeId: contentType.id },
    include: {
      ...entryInclude,
      contentType: { include: { fields: { orderBy: { sortOrder: "asc" } } } },
    },
  });
  if (!entry || entry.contentType.websiteId !== input.websiteId) {
    throw Object.assign(new Error("Entry not found"), { statusCode: 404 });
  }

  const fields: Record<string, unknown> = {};
  for (const fv of entry.fieldValues) {
    fields[fv.field.apiId] = fv.value;
  }

  const websiteContext = await buildWebsiteKnowledge(input.websiteId, {
    contentTypeApiId: input.contentTypeApiId,
    entryId: input.entryId,
    mode: input.mode,
  });

  const { plan, model } = await requestPatchPlan({
    config,
    mode: input.mode,
    instruction: input.message,
    contentTypeApiId: input.contentTypeApiId,
    websiteId: input.websiteId,
    websiteContext,
    entry: {
      id: entry.id,
      slug: entry.slug,
      fields,
      fieldDefs: entry.contentType.fields.map((f) => ({
        apiId: f.apiId,
        name: f.name,
        type: f.type,
      })),
    },
  });

  const toolCalls: AiToolCallResult[] = [];
  let versionCreated: AiChatResponse["versionCreated"] = null;

  if (plan.patches.length === 0) {
    return {
      reply: plan.summary || "No field changes were needed.",
      toolCalls: [],
      model,
      entry: serializeEntry(entry),
      versionCreated: null,
    };
  }

  const version = await createEntryVersion({
    entryId: entry.id,
    label: input.mode === "optimize" ? "Before AI optimize" : "Before AI write",
    source: "ai",
  });
  versionCreated = {
    id: version.id,
    label: version.label,
    createdAt: version.createdAt,
  };

  const fieldByApiId = new Map(
    entry.contentType.fields.map((f) => [f.apiId, f]),
  );
  const nextValues: Record<string, unknown> = { ...fields };

  for (const patch of plan.patches) {
    const def = fieldByApiId.get(patch.fieldApiId);
    if (!def) {
      toolCalls.push({
        name: patch.op,
        ok: false,
        summary: `Unknown field ${patch.fieldApiId}`,
      });
      continue;
    }

    try {
      if (patch.op === "str_replace") {
        const current = nextValues[patch.fieldApiId];
        if (typeof current !== "string") {
          throw new Error(
            `Field ${patch.fieldApiId} is not a string; use write instead`,
          );
        }
        const updated = applyStrReplace(
          current,
          patch.old_string,
          patch.new_string,
          patch.replace_all ?? false,
        );
        nextValues[patch.fieldApiId] = updated;
        toolCalls.push({
          name: "str_replace",
          ok: true,
          summary: `Patched ${patch.fieldApiId}`,
        });
      } else {
        nextValues[patch.fieldApiId] = patch.value;
        toolCalls.push({
          name: "write_field",
          ok: true,
          summary: `Wrote ${patch.fieldApiId}`,
        });
      }
    } catch (error) {
      toolCalls.push({
        name: patch.op,
        ok: false,
        summary:
          error instanceof Error
            ? `${patch.fieldApiId}: ${error.message}`
            : `Failed ${patch.fieldApiId}`,
      });
    }
  }

  const changed = toolCalls.some((t) => t.ok);
  if (changed) {
    const payload: Record<string, unknown> = {};
    for (const patch of plan.patches) {
      const success = toolCalls.some(
        (t) =>
          t.ok &&
          t.summary.includes(patch.fieldApiId) &&
          ((patch.op === "str_replace" && t.name === "str_replace") ||
            (patch.op === "write" && t.name === "write_field")),
      );
      if (success) {
        payload[patch.fieldApiId] = nextValues[patch.fieldApiId];
      }
    }
    await setEntryFields(entry.id, entry.contentTypeId, payload);
  }

  const full = await prisma.entry.findUniqueOrThrow({
    where: { id: entry.id },
    include: entryInclude,
  });

  const applied = toolCalls.filter((t) => t.ok).length;
  const failed = toolCalls.filter((t) => !t.ok).length;
  const reply = [
    plan.summary || "Applied AI field patches.",
    `Applied ${applied} patch(es)${failed ? `, ${failed} failed` : ""}.`,
    versionCreated ? `Saved version: ${versionCreated.label}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    reply,
    toolCalls,
    model,
    entry: serializeEntry(full),
    versionCreated,
  };
}
