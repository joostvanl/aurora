import type { ResolvedAiConfig } from "./config.js";
import {
  recordAiUsage,
  type AiUsageMeter,
  type TokenUsage,
} from "./usage.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

export type ChatTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatCompletionResult = {
  message: ChatMessage;
  model: string;
  usage: TokenUsage;
};

function parseUsage(parsed: unknown): TokenUsage {
  const usage =
    parsed &&
    typeof parsed === "object" &&
    "usage" in parsed &&
    (parsed as { usage?: unknown }).usage &&
    typeof (parsed as { usage: unknown }).usage === "object"
      ? ((parsed as { usage: Record<string, unknown> }).usage)
      : null;

  const promptTokens =
    typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : 0;
  const completionTokens =
    typeof usage?.completion_tokens === "number" ? usage.completion_tokens : 0;
  const totalTokens =
    typeof usage?.total_tokens === "number"
      ? usage.total_tokens
      : promptTokens + completionTokens;

  return {
    promptTokens,
    completionTokens,
    totalTokens,
  };
}

export async function chatCompletion(options: {
  config: ResolvedAiConfig;
  messages: ChatMessage[];
  tools?: ChatTool[];
  toolChoice?: "auto" | "required" | "none";
  responseFormatJson?: boolean;
  /** When set, persist token usage for this website. */
  meter?: AiUsageMeter;
}): Promise<ChatCompletionResult> {
  const { config, messages, tools } = options;
  if (!config.baseUrl || !config.apiKey || !config.model) {
    throw Object.assign(new Error("AI is not configured"), { statusCode: 503 });
  }

  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: 0.3,
  };

  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = options.toolChoice ?? "auto";
  }

  if (options.responseFormatJson) {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    // Some gateways reject response_format — retry once without it.
    if (
      options.responseFormatJson &&
      res.status >= 400 &&
      res.status < 500
    ) {
      return chatCompletion({
        ...options,
        responseFormatJson: false,
      });
    }

    const message =
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof (parsed as { error?: { message?: string } }).error?.message ===
        "string"
        ? (parsed as { error: { message: string } }).error.message
        : `AI provider error (${res.status})`;
    throw Object.assign(new Error(message), { statusCode: 502 });
  }

  const choice = (
    parsed as {
      choices?: Array<{ message?: ChatMessage }>;
      model?: string;
    }
  )?.choices?.[0]?.message;

  if (!choice) {
    throw Object.assign(new Error("AI provider returned no message"), {
      statusCode: 502,
    });
  }

  const model = (parsed as { model?: string }).model ?? config.model;
  const usage = parseUsage(parsed);

  if (options.meter) {
    try {
      await recordAiUsage({
        websiteId: options.meter.websiteId,
        userId: options.meter.userId,
        source: options.meter.source,
        model,
        usage,
      });
    } catch {
      // Metering must not break chat.
    }
  }

  return {
    message: choice,
    model,
    usage,
  };
}
