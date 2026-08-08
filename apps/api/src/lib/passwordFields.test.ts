import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../auth/password.js";
import {
  hashPasswordFieldValue,
  isPasswordLeaveUnchanged,
  PASSWORD_SET_MARKER,
  redactPasswordFieldValue,
  storedPasswordHash,
  verifyStoredPasswordHash,
} from "./passwordFields.js";

describe("passwordFields", () => {
  it("treats empty and set-marker as leave-unchanged", () => {
    expect(isPasswordLeaveUnchanged("")).toBe(true);
    expect(isPasswordLeaveUnchanged(null)).toBe(true);
    expect(isPasswordLeaveUnchanged(undefined)).toBe(true);
    expect(isPasswordLeaveUnchanged(PASSWORD_SET_MARKER)).toBe(true);
    expect(isPasswordLeaveUnchanged({ set: true })).toBe(true);
    expect(isPasswordLeaveUnchanged("secret")).toBe(false);
  });

  it("hashes plaintext for storage", () => {
    const stored = hashPasswordFieldValue("hunter2-secret");
    expect(typeof stored).toBe("string");
    expect(stored).not.toContain("hunter2");
    expect(verifyPassword("hunter2-secret", String(stored))).toBe(true);
  });

  it("rejects non-string / empty plaintext", () => {
    expect(() => hashPasswordFieldValue("")).toThrow(/non-empty/i);
    expect(() => hashPasswordFieldValue(12)).toThrow(/non-empty|string/i);
  });

  it("redacts stored hashes to { set: true }", () => {
    const hash = hashPassword("abc");
    expect(redactPasswordFieldValue(hash)).toEqual({ set: true });
    expect(redactPasswordFieldValue(null)).toBeNull();
    expect(redactPasswordFieldValue("")).toBeNull();
  });

  it("extracts stored scrypt hashes and verifies plaintext", () => {
    const hash = hashPassword("hunter2-secret");
    expect(storedPasswordHash(hash)).toBe(hash);
    expect(storedPasswordHash(null)).toBeNull();
    expect(storedPasswordHash("")).toBeNull();
    expect(storedPasswordHash({ set: true })).toBeNull();
    expect(verifyStoredPasswordHash("hunter2-secret", hash)).toBe(true);
    expect(verifyStoredPasswordHash("wrong", hash)).toBe(false);
  });

  it("throws PASSWORD_NOT_SET when no hash is stored", () => {
    expect(() => verifyStoredPasswordHash("any", null)).toThrow(/not set/i);
  });
});
