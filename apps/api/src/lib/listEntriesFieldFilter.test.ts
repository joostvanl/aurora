import { describe, expect, it } from "vitest";
import { LIST_ENTRIES_IN_MAX, ListEntriesQuerySchema } from "@cms/shared";
import {
  fieldFilterToPrismaSome,
  resolveListFieldFilter,
} from "./listEntriesFieldFilter.js";

describe("ListEntriesQuerySchema field filter", () => {
  it("parses field + comma-separated in into inValues", () => {
    const q = ListEntriesQuerySchema.parse({
      field: "ticket",
      in: " a ,b, ,c ",
    });
    expect(q.field).toBe("ticket");
    expect(q.inValues).toEqual(["a", "b", "c"]);
  });

  it("allows omitting field and in", () => {
    const q = ListEntriesQuerySchema.parse({});
    expect(q.field).toBeUndefined();
    expect(q.inValues).toBeUndefined();
  });

  it("rejects field without in", () => {
    expect(() => ListEntriesQuerySchema.parse({ field: "ticket" })).toThrow(
      /in/i,
    );
  });

  it("rejects in without field", () => {
    expect(() => ListEntriesQuerySchema.parse({ in: "x" })).toThrow(/field/i);
  });

  it("rejects empty in after trim", () => {
    expect(() =>
      ListEntriesQuerySchema.parse({ field: "ticket", in: " , , " }),
    ).toThrow(/in/i);
  });

  it(`rejects more than ${LIST_ENTRIES_IN_MAX} in values`, () => {
    const many = Array.from({ length: LIST_ENTRIES_IN_MAX + 1 }, (_, i) => `v${i}`);
    expect(() =>
      ListEntriesQuerySchema.parse({ field: "ticket", in: many.join(",") }),
    ).toThrow(/at most/i);
  });
});

describe("resolveListFieldFilter", () => {
  const fields = [
    { id: "f-ticket", apiId: "ticket", type: "text" },
    { id: "f-parent", apiId: "parent", type: "relation" },
    { id: "f-tags", apiId: "tags", type: "relations" },
    { id: "f-count", apiId: "count", type: "number" },
    { id: "f-flag", apiId: "flag", type: "boolean" },
    { id: "f-body", apiId: "body", type: "richtext" },
    { id: "f-pass", apiId: "password", type: "password" },
  ];

  it("returns null when no field requested", () => {
    expect(resolveListFieldFilter({ fields })).toBeNull();
  });

  it("resolves text field filter", () => {
    const filter = resolveListFieldFilter({
      fields,
      fieldApiId: "ticket",
      inValues: ["cms-52", "cms-1"],
    });
    expect(filter).toMatchObject({
      fieldId: "f-ticket",
      fieldApiId: "ticket",
      fieldType: "text",
      values: ["cms-52", "cms-1"],
      jsonValues: ["cms-52", "cms-1"],
    });
  });

  it("resolves relation and relations", () => {
    expect(
      resolveListFieldFilter({
        fields,
        fieldApiId: "parent",
        inValues: ["home"],
      })?.fieldType,
    ).toBe("relation");
    expect(
      resolveListFieldFilter({
        fields,
        fieldApiId: "tags",
        inValues: ["a", "b"],
      })?.fieldType,
    ).toBe("relations");
  });

  it("coerces number and boolean tokens", () => {
    expect(
      resolveListFieldFilter({
        fields,
        fieldApiId: "count",
        inValues: ["3", "4.5"],
      })?.jsonValues,
    ).toEqual([3, 4.5]);
    expect(
      resolveListFieldFilter({
        fields,
        fieldApiId: "flag",
        inValues: ["true", "0"],
      })?.jsonValues,
    ).toEqual([true, false]);
  });

  it("rejects unknown field", () => {
    expect(() =>
      resolveListFieldFilter({
        fields,
        fieldApiId: "nope",
        inValues: ["x"],
      }),
    ).toThrow(/Unknown field/);
  });

  it("rejects unsupported types", () => {
    expect(() =>
      resolveListFieldFilter({
        fields,
        fieldApiId: "body",
        inValues: ["x"],
      }),
    ).toThrow(/not filterable/);
    expect(() =>
      resolveListFieldFilter({
        fields,
        fieldApiId: "password",
        inValues: ["x"],
      }),
    ).toThrow(/not filterable/);
  });

  it("rejects invalid number / boolean tokens", () => {
    expect(() =>
      resolveListFieldFilter({
        fields,
        fieldApiId: "count",
        inValues: ["abc"],
      }),
    ).toThrow(/Invalid number/);
    expect(() =>
      resolveListFieldFilter({
        fields,
        fieldApiId: "flag",
        inValues: ["maybe"],
      }),
    ).toThrow(/Invalid boolean/);
  });
});

describe("fieldFilterToPrismaSome", () => {
  it("builds equals OR for scalar fields", () => {
    const filter = resolveListFieldFilter({
      fields: [{ id: "f1", apiId: "ticket", type: "text" }],
      fieldApiId: "ticket",
      inValues: ["a", "b"],
    })!;
    expect(fieldFilterToPrismaSome(filter)).toEqual({
      some: {
        fieldId: "f1",
        OR: [{ value: { equals: "a" } }, { value: { equals: "b" } }],
      },
    });
  });

  it("builds array_contains OR for relations", () => {
    const filter = resolveListFieldFilter({
      fields: [{ id: "f2", apiId: "tags", type: "relations" }],
      fieldApiId: "tags",
      inValues: ["x"],
    })!;
    expect(fieldFilterToPrismaSome(filter)).toEqual({
      some: {
        fieldId: "f2",
        OR: [{ value: { array_contains: "x" } }],
      },
    });
  });
});
