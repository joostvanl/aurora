import type { ResolvedAiConfig } from "./config.js";

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
};

export async function chatCompletion(options: {
  config: ResolvedAiConfig;
  messages: ChatMessage[];
  tools?: ChatTool[];
  toolChoice?: "auto" | "required" | "none";
  responseFormatJson?: boolean;
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

  return {
    message: choice,
    model: (parsed as { model?: string }).model ?? config.model,
  };
}
