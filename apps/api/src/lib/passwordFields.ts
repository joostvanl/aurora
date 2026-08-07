import type { Prisma } from "@prisma/client";
import { hashPassword } from "../auth/password.js";
import { httpError } from "./httpError.js";

/** Public/admin marker: password is set, raw hash never returned. */
export const PASSWORD_SET_MARKER = { set: true as const };

export type PasswordSetMarker = typeof PASSWORD_SET_MARKER;

/** Empty / marker means keep the existing stored hash on update. */
export function isPasswordLeaveUnchanged(value: unknown): boolean {
  if (value == null || value === "") return true;
  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).set === true
  ) {
    return true;
  }
  return false;
}

export function redactPasswordFieldValue(
  stored: unknown,
): PasswordSetMarker | null {
  if (stored == null || stored === "") return null;
  return PASSWORD_SET_MARKER;
}

/** Hash a new password plaintext for EntryFieldValue storage. */
export function hashPasswordFieldValue(value: unknown): Prisma.InputJsonValue {
  if (typeof value !== "string" || !value.trim()) {
    throw httpError(
      400,
      "Password field requires a non-empty string",
      "VALIDATION_FAILED",
    );
  }
  return hashPassword(value);
}
