import { describe, expect, it } from "vitest";
import { parseJsonStrict, JsonStrictParseError } from "./parseJsonStrict.js";

describe("parseJsonStrict", () => {
  it("parses objects, arrays, and scalars", () => {
    expect(parseJsonStrict('{"a":1,"b":[true,null,"x"]}')).toEqual({
      a: 1,
      b: [true, null, "x"],
    });
  });

  it("rejects duplicate keys during parse", () => {
    expect(() => parseJsonStrict('{"id":1,"id":2}')).toThrow(JsonStrictParseError);
    expect(() => parseJsonStrict('{"id":1,"id":2}')).toThrow(/Duplicate key/);
  });

  it("rejects nested duplicate keys", () => {
    expect(() => parseJsonStrict('{"outer":{"k":1,"k":2}}')).toThrow(
      /Duplicate key/,
    );
  });

  it("rejects trailing commas and trailing data", () => {
    expect(() => parseJsonStrict('{"a":1,}')).toThrow(JsonStrictParseError);
    expect(() => parseJsonStrict("[1,2] extra")).toThrow(/trailing/i);
  });

  it("keeps both keys when JSON.parse would collapse them", () => {
    const collapsed = JSON.parse('{"a":1,"a":2}') as { a: number };
    expect(collapsed.a).toBe(2);
    expect(() => parseJsonStrict('{"a":1,"a":2}')).toThrow(JsonStrictParseError);
  });
});
