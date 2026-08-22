import { describe, expect, it } from "vitest";
import { applyStrReplace, normalizeNewlines } from "./patches.js";

describe("normalizeNewlines", () => {
  it("converts CRLF to LF", () => {
    expect(normalizeNewlines("a\r\nb")).toBe("a\nb");
  });

  it("converts lone CR to LF", () => {
    expect(normalizeNewlines("a\rb\r\nc")).toBe("a\nb\nc");
  });
});

describe("applyStrReplace", () => {
  it("replaces a unique match and leaves the rest byte-identical", () => {
    const content = "Hello world\nGoodbye";
    const result = applyStrReplace(content, "world", "earth");
    expect(result).toBe("Hello earth\nGoodbye");
  });

  it("throws when old_string is not found", () => {
    expect(() => applyStrReplace("abc", "zzz", "x")).toThrow(
      "old_string not found",
    );
  });

  it("throws when old_string matches multiple times without replace_all", () => {
    expect(() => applyStrReplace("foo foo", "foo", "bar")).toThrow(
      "multiple times",
    );
  });

  it("replaces all matches when replace_all is true", () => {
    expect(applyStrReplace("foo foo foo", "foo", "bar", true)).toBe(
      "bar bar bar",
    );
  });

  it("treats metacharacters literally", () => {
    expect(applyStrReplace("a.*b", ".*", "X")).toBe("aXb");
  });

  it("matches after newline normalization", () => {
    const content = normalizeNewlines("line1\r\nline2");
    const result = applyStrReplace(content, "line1\nline2", "merged");
    expect(result).toBe("merged");
  });

  it("allows empty new_string to delete a fragment", () => {
    expect(applyStrReplace("abcXYZdef", "XYZ", "")).toBe("abcdef");
  });
});
