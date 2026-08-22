import { describe, expect, it } from "vitest";
import { isSecretField } from "./fields.js";
import {
  AI_ENTRY_FIELD_MAX_CHARS,
  entryFieldForAi,
  type EntryFieldRead,
} from "./entryField.js";
import { fieldDigest } from "./fieldHash.js";

function sample(value: string): EntryFieldRead {
  const digest = fieldDigest(value);
  return {
    entryId: "e1",
    fieldApiId: "body",
    value,
    length: digest.length,
    sha256: digest.sha256,
    byteLength: digest.byteLength,
    truncated: false,
    updatedAt: "2026-08-22T00:00:00.000Z",
  };
}

describe("isSecretField", () => {
  it("treats password as secret and username as readable (R6)", () => {
    expect(isSecretField({ type: "password" })).toBe(true);
    expect(isSecretField({ type: "username" })).toBe(false);
    expect(isSecretField({ type: "textarea" })).toBe(false);
  });
});

describe("entryFieldForAi", () => {
  it("returns the full 15k prose value (R1)", () => {
    const value = "A".repeat(15_000);
    const result = entryFieldForAi(sample(value));
    expect(result.ok).toBe(true);
    expect(result.data.value).toBe(value);
    expect(result.data.value).toHaveLength(15_000);
    expect(result.data.truncated).toBe(false);
    expect(result.data.sha256).toBe(fieldDigest(value).sha256);
  });

  it("returns full richtext HTML (R2)", () => {
    const value = `<p>${"hello ".repeat(3_000)}</p>`;
    const result = entryFieldForAi(sample(value));
    expect(result.ok).toBe(true);
    expect(result.data.value).toBe(value);
    expect(result.data.truncated).toBe(false);
  });

  it("fails with FIELD_TOO_LARGE and no value above 200k (R3)", () => {
    const value = "x".repeat(AI_ENTRY_FIELD_MAX_CHARS + 1);
    const result = entryFieldForAi(sample(value));
    expect(result.ok).toBe(false);
    expect(result.code).toBe("FIELD_TOO_LARGE");
    expect(result.data.value).toBeUndefined();
    expect(result.data.length).toBe(AI_ENTRY_FIELD_MAX_CHARS + 1);
    expect(result.data.sha256).toBe(fieldDigest(value).sha256);
  });

  it("HTTP/MCP path keeps the raw EntryFieldRead including >200k (R4)", () => {
    const value = "x".repeat(AI_ENTRY_FIELD_MAX_CHARS + 50);
    const field = sample(value);
    expect(field.value).toBe(value);
    expect(field.truncated).toBe(false);
  });
});
