import { CmsApiError } from "@cms/shared";

export function toolError(err: unknown): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
} {
  if (err instanceof CmsApiError) {
    const body =
      err.body && typeof err.body === "object"
        ? (err.body as Record<string, unknown>)
        : null;
    const code =
      body && typeof body.code === "string" ? body.code : `HTTP_${err.status}`;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: false,
              message: err.message,
              code,
              status: err.status,
              body: err.body ?? null,
            },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ ok: false, message, code: "MCP_ERROR" }, null, 2),
      },
    ],
    isError: true,
  };
}

export function toolOk(data: unknown): {
  content: Array<{ type: "text"; text: string }>;
} {
  return {
    content: [
      {
        type: "text",
        text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}
