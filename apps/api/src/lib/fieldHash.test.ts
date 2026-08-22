import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeNewlines } from "../ai/patches.js";
import {
  assertExpectedFieldHash,
  fieldDigest,
  hashesEqual,
} from "./fieldHash.js";

describe("fieldDigest", () => {
  it("hashes newline-normalized UTF-8 bytes as lowercase hex", () => {
    const value = "Hello\r\nworld\r!";
    const digest = fieldDigest(value);
    const expected = createHash("sha256")
      .update(Buffer.from(normalizeNewlines(value), "utf8"))
      .digest("hex");
    expect(digest.sha256).toBe(expected);
    expect(digest.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(digest.length).toBe(value.length);
    expect(digest.byteLength).toBe(Buffer.byteLength(value, "utf8"));
  });

  it("does not trim or add/strip a final newline", () => {
    const withNl = "abc\n";
    const without = "abc";
    expect(fieldDigest(withNl).sha256).not.toBe(fieldDigest(without).sha256);
    expect(fieldDigest("  x  ").length).toBe(5);
  });
});

describe("assertExpectedFieldHash", () => {
  it("accepts a matching hash", () => {
    const value = "body text";
    expect(() =>
      assertExpectedFieldHash("body", value, fieldDigest(value).sha256),
    ).not.toThrow();
  });

  it("throws 409 STALE_HASH on mismatch", () => {
    try {
      assertExpectedFieldHash("body", "current", "a".repeat(64));
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toMatchObject({
        statusCode: 409,
        apiCode: "STALE_HASH",
      });
    }
  });

  it("compares hashes case-insensitively", () => {
    const digest = fieldDigest("x");
    expect(hashesEqual(digest.sha256, digest.sha256.toUpperCase())).toBe(true);
    expect(() =>
      assertExpectedFieldHash("body", "x", digest.sha256.toUpperCase()),
    ).not.toThrow();
  });
});
