/** Stable machine-readable API error codes (public + admin). */
export type ApiErrorCode =
  | "SITE_KEY_MISSING"
  | "SITE_KEY_INVALID"
  | "ENTRY_NOT_FOUND"
  | "ENTRY_NOT_PUBLISHED"
  | "CONTENT_TYPE_NOT_FOUND"
  | "FORM_NOT_FOUND"
  | "ORIGIN_NOT_ALLOWED"
  | "RATE_LIMITED"
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "INTERNAL_ERROR";

export type ApiIssue = {
  path: Array<string | number>;
  code: string;
  message: string;
};

export function httpError(
  statusCode: number,
  message: string,
  code?: ApiErrorCode,
  issues?: ApiIssue[],
) {
  const err = new Error(message) as Error & {
    statusCode: number;
    apiCode?: ApiErrorCode;
    issues?: ApiIssue[];
  };
  err.statusCode = statusCode;
  if (code) err.apiCode = code;
  if (issues) err.issues = issues;
  return err;
}

export function defaultCodeForStatus(statusCode: number): ApiErrorCode {
  switch (statusCode) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 429:
      return "RATE_LIMITED";
    default:
      return statusCode >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST";
  }
}
