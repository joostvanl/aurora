import type { Prisma } from "@prisma/client";
import { hashPassword, verifyPassword } from "../auth/password.js";
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

/**
 * Extract the scrypt `salt:hash` string from an EntryFieldValue JSON cell.
 * Returns null when unset / empty / not a hash string.
 */
export function storedPasswordHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const [salt, hash] = trimmed.split(":");
  if (!salt || !hash) return null;
  return trimmed;
}

/**
 * Timing-safe check of plaintext against a stored password-field hash.
 * Does not throw on mismatch — returns false. Throws only for missing hash.
 */
export function verifyStoredPasswordHash(
  plaintext: string,
  stored: unknown,
): boolean {
  const hash = storedPasswordHash(stored);
  if (!hash) {
    throw httpError(400, "Password is not set on this entry", "PASSWORD_NOT_SET");
  }
  return verifyPassword(plaintext, hash);
}
