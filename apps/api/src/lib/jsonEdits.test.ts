import { describe, expect, it, vi } from "vitest";
import { fieldDigest } from "./fieldHash.js";
import {
  applyEntryJsonEdits,
  applyJsonEditsToString,
  objectMatches,
  resolveArrayPointer,
} from "./jsonEdits.js";

const itemsDoc = {
  items: [
    { key: "a", name: "Alpha" },
    { key: "b", name: "Beta" },
  ],
};

function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

describe("resolveArrayPointer", () => {
  it("resolves /items to the array", () => {
    expect(resolveArrayPointer(itemsDoc, "/items")).toBe(itemsDoc.items);
  });

  it("rejects a property path that is not an array", () => {
    expect(() => resolveArrayPointer(itemsDoc, "/items/0")).toThrow(
      /does not resolve to an array/,
    );
  });
});

describe("objectMatches", () => {
  it("matches a subset of keys", () => {
    expect(objectMatches({ key: "a", name: "Alpha" }, { key: "a" })).toBe(true);
    expect(objectMatches({ key: "a" }, { key: "b" })).toBe(false);
  });
});

describe("applyJsonEditsToString", () => {
  it("inserts after a matched object and keeps siblings (J1)", () => {
    const raw = JSON.stringify(itemsDoc, null, 2);
    const next = applyJsonEditsToString(
      raw,
      [
        {
          path: "/items",
          match: { key: "a" },
          op: "insert_after",
          value: { key: "c", name: "Gamma" },
        },
      ],
      "payload",
    );
    const parsed = JSON.parse(next) as typeof itemsDoc;
    expect(parsed.items.map((i) => i.key)).toEqual(["a", "c", "b"]);
    expect(parsed.items[0]).toEqual({ key: "a", name: "Alpha" });
    expect(parsed.items[2]).toEqual({ key: "b", name: "Beta" });
  });

  it("ignores indent and key order of the stored JSON (J2)", () => {
    const messy = '{"items":[{"name":"Alpha","key":"a"},{"key":"b","name":"Beta"}]}';
    const next = applyJsonEditsToString(
      messy,
      [
        {
          path: "/items",
          match: { key: "a" },
          op: "replace",
          value: { name: "A1" },
        },
      ],
      "payload",
    );
    expect(JSON.parse(next)).toEqual({
      items: [
        { name: "A1", key: "a" },
        { key: "b", name: "Beta" },
      ],
    });
    expect(next).toBe(JSON.stringify(JSON.parse(next), null, 2));
  });

  it("returns 409 when match count is 0 or >1 (J3)", () => {
    const raw = compactJson(itemsDoc);
    try {
      applyJsonEditsToString(
        raw,
        [{ path: "/items", match: { key: "missing" }, op: "remove" }],
        "payload",
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toMatchObject({
        statusCode: 409,
        issues: [{ code: "not_found" }],
      });
    }

    const dup = compactJson({
      items: [
        { key: "a", name: "1" },
        { key: "a", name: "2" },
      ],
    });
    try {
      applyJsonEditsToString(
        dup,
        [{ path: "/items", match: { key: "a" }, op: "remove" }],
        "payload",
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toMatchObject({
        statusCode: 409,
        issues: [{ code: "ambiguous" }],
      });
    }
  });

  it("returns 400 when path points at an object (J4)", () => {
    try {
      applyJsonEditsToString(
        compactJson(itemsDoc),
        [
          {
            path: "/items/0",
            match: { key: "a" },
            op: "replace",
            value: { name: "x" },
          },
        ],
        "payload",
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 400 });
    }
  });

  it("does not persist when a later op fails (J6)", () => {
    const raw = JSON.stringify(itemsDoc);
    try {
      applyJsonEditsToString(
        raw,
        [
          {
            path: "/items",
            match: { key: "a" },
            op: "replace",
            value: { name: "changed" },
          },
          {
            path: "/items",
            match: { key: "missing" },
            op: "remove",
          },
        ],
        "payload",
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toMatchObject({ statusCode: 409, issues: [{ code: "not_found" }] });
    }
  });

  it("lets a later op see earlier in-memory results", () => {
    const next = applyJsonEditsToString(
      compactJson(itemsDoc),
      [
        {
          path: "/items",
          match: { key: "a" },
          op: "insert_after",
          value: { key: "c", name: "Gamma" },
        },
        {
          path: "/items",
          match: { key: "c" },
          op: "replace",
          value: { name: "C2" },
        },
      ],
      "payload",
    );
    expect(JSON.parse(next).items.find((i: { key: string }) => i.key === "c")).toEqual({
      key: "c",
      name: "C2",
    });
  });
});

function makeTx(overrides: {
  definitions?: Array<{ id: string; apiId: string; type: string }>;
  values?: Record<string, unknown>;
}) {
  const values = new Map<string, unknown>(Object.entries(overrides.values ?? {}));
  return {
    values,
    fieldDefinition: {
      findMany: vi.fn(async () => overrides.definitions ?? []),
    },
    entryFieldValue: {
      findMany: vi.fn(async ({ where }: { where: { fieldId: { in: string[] } } }) =>
        where.fieldId.in.map((fieldId) => ({
          fieldId,
          value: values.get(fieldId) ?? null,
        })),
      ),
      upsert: vi.fn(async ({ create }: { create: { fieldId: string; value: unknown } }) => {
        values.set(create.fieldId, create.value);
      }),
    },
    entry: {
      update: vi.fn(async () => ({})),
    },
  };
}

describe("applyEntryJsonEdits", () => {
  it("writes nothing when the second field fails (J5)", async () => {
    const tx = makeTx({
      definitions: [
        { id: "f1", apiId: "left", type: "textarea" },
        { id: "f2", apiId: "right", type: "textarea" },
      ],
      values: {
        f1: compactJson({ items: [{ key: "a" }] }),
        f2: compactJson({ items: [{ key: "a" }] }),
      },
    });

    await expect(
      applyEntryJsonEdits(tx as never, {
        entryId: "e1",
        contentTypeId: "ct1",
        jsonEdits: {
          left: [
            {
              path: "/items",
              match: { key: "a" },
              op: "replace",
              value: { name: "ok" },
            },
          ],
          right: [
            {
              path: "/items",
              match: { key: "missing" },
              op: "remove",
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ statusCode: 409, issues: [{ code: "not_found" }] });

    expect(tx.entryFieldValue.upsert).not.toHaveBeenCalled();
    expect(tx.values.get("f1")).toBe(compactJson({ items: [{ key: "a" }] }));
  });

  it("rejects a stale hash before writing", async () => {
    const current = compactJson({ items: [{ key: "a" }] });
    const tx = makeTx({
      definitions: [{ id: "f1", apiId: "payload", type: "textarea" }],
      values: { f1: current },
    });

    await expect(
      applyEntryJsonEdits(tx as never, {
        entryId: "e1",
        contentTypeId: "ct1",
        jsonEdits: {
          payload: [
            {
              path: "/items",
              match: { key: "a" },
              op: "remove",
            },
          ],
        },
        expectedHashes: { payload: "a".repeat(64) },
      }),
    ).rejects.toMatchObject({ statusCode: 409, apiCode: "STALE_HASH" });
    expect(tx.entryFieldValue.upsert).not.toHaveBeenCalled();
  });

  it("applies with a correct hash", async () => {
    const current = compactJson({ items: [{ key: "a", name: "A" }] });
    const tx = makeTx({
      definitions: [{ id: "f1", apiId: "payload", type: "textarea" }],
      values: { f1: current },
    });

    const summary = await applyEntryJsonEdits(tx as never, {
      entryId: "e1",
      contentTypeId: "ct1",
      jsonEdits: {
        payload: [
          {
            path: "/items",
            match: { key: "a" },
            op: "replace",
            value: { name: "B" },
          },
        ],
      },
      expectedHashes: { payload: fieldDigest(current).sha256 },
    });

    expect(summary.applied).toBe(1);
    expect(summary.fields.payload.sha256).toBe(
      fieldDigest(tx.values.get("f1") as string).sha256,
    );
  });
});
