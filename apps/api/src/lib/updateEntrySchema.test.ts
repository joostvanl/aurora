import { describe, expect, it } from "vitest";
import { UpdateEntrySchema } from "@cms/shared";

describe("UpdateEntrySchema (CMS-57)", () => {
  it("allows hash-less field_edits (G1)", () => {
    const parsed = UpdateEntrySchema.parse({
      field_edits: {
        body: [{ old_string: "a", new_string: "b" }],
      },
    });
    expect(parsed.field_edits?.body).toHaveLength(1);
    expect(parsed.expected_field_hashes).toBeUndefined();
  });

  it("rejects the same field in fields and json_edits", () => {
    const result = UpdateEntrySchema.safeParse({
      fields: { payload: "x" },
      json_edits: {
        payload: [
          {
            path: "/items",
            match: { key: "a" },
            op: "remove",
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects the same field in field_edits and json_edits", () => {
    const result = UpdateEntrySchema.safeParse({
      field_edits: {
        payload: [{ old_string: "a", new_string: "b" }],
      },
      json_edits: {
        payload: [
          {
            path: "/items",
            match: { key: "a" },
            op: "remove",
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });
});
