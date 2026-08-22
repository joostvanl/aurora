import { describe, expect, it, vi } from "vitest";
import { applyEntryFieldEdits } from "./fieldEdits.js";
import { fieldDigest } from "./fieldHash.js";

function makeTx(overrides: {
  definitions?: Array<{ id: string; apiId: string; type: string }>;
  values?: Record<string, unknown>;
}) {
  const values = new Map<string, unknown>(
    Object.entries(overrides.values ?? {}),
  );

  return {
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

describe("applyEntryFieldEdits", () => {
  it("applies a single edit and returns summary", async () => {
    const tx = makeTx({
      definitions: [{ id: "f1", apiId: "body", type: "textarea" }],
      values: { f1: "Hello world" },
    });

    const summary = await applyEntryFieldEdits(tx as never, {
      entryId: "e1",
      contentTypeId: "ct1",
      fieldEdits: {
        body: [{ old_string: "world", new_string: "earth" }],
      },
    });

    expect(summary).toEqual({
      applied: 1,
      fields: {
        body: {
          length: "Hello earth".length,
          sha256: fieldDigest("Hello earth").sha256,
        },
      },
    });
    expect(tx.entryFieldValue.upsert).toHaveBeenCalledOnce();
  });

  it("returns 409 when anchor is not found on a string field", async () => {
    const tx = makeTx({
      definitions: [{ id: "f1", apiId: "body", type: "textarea" }],
      values: { f1: "Hello world" },
    });

    await expect(
      applyEntryFieldEdits(tx as never, {
        entryId: "e1",
        contentTypeId: "ct1",
        fieldEdits: {
          body: [{ old_string: "missing", new_string: "x" }],
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      apiCode: "CONFLICT",
      issues: [
        {
          path: ["field_edits", "body", 0],
          code: "not_found",
        },
      ],
    });
    expect(tx.entryFieldValue.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 for unknown field apiId", async () => {
    const tx = makeTx({ definitions: [] });

    await expect(
      applyEntryFieldEdits(tx as never, {
        entryId: "e1",
        contentTypeId: "ct1",
        fieldEdits: {
          body: [{ old_string: "a", new_string: "b" }],
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
    });
  });

  it("returns 400 for slug field type", async () => {
    const tx = makeTx({
      definitions: [{ id: "f1", apiId: "permalink", type: "slug" }],
      values: { f1: "hello-world" },
    });

    await expect(
      applyEntryFieldEdits(tx as never, {
        entryId: "e1",
        contentTypeId: "ct1",
        fieldEdits: {
          permalink: [{ old_string: "hello", new_string: "hi" }],
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
    });
  });

  it("returns 400 when current value is not a string", async () => {
    const tx = makeTx({
      definitions: [{ id: "f1", apiId: "count", type: "number" }],
      values: { f1: 42 },
    });

    await expect(
      applyEntryFieldEdits(tx as never, {
        entryId: "e1",
        contentTypeId: "ct1",
        fieldEdits: {
          count: [{ old_string: "4", new_string: "5" }],
        },
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      apiCode: "VALIDATION_FAILED",
    });
  });

  it("serializes sequential edits on the same field", async () => {
    const tx = makeTx({
      definitions: [{ id: "f1", apiId: "body", type: "textarea" }],
      values: { f1: "aa bb aa" },
    });

    const summary = await applyEntryFieldEdits(tx as never, {
      entryId: "e1",
      contentTypeId: "ct1",
      fieldEdits: {
        body: [
          { old_string: "aa", new_string: "xx", replace_all: true },
          { old_string: "bb", new_string: "yy" },
        ],
      },
    });

    expect(summary.applied).toBe(2);
    expect(summary.fields.body.length).toBe("xx yy xx".length);
  });

  it("returns 409 STALE_HASH and does not write (C1)", async () => {
    const tx = makeTx({
      definitions: [{ id: "f1", apiId: "body", type: "textarea" }],
      values: { f1: "Hello world" },
    });

    await expect(
      applyEntryFieldEdits(tx as never, {
        entryId: "e1",
        contentTypeId: "ct1",
        fieldEdits: {
          body: [{ old_string: "world", new_string: "earth" }],
        },
        expectedHashes: { body: "a".repeat(64) },
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      apiCode: "STALE_HASH",
    });
    expect(tx.entryFieldValue.upsert).not.toHaveBeenCalled();
  });

  it("applies when the expected hash matches (C2, G1 hash-less still works above)", async () => {
    const tx = makeTx({
      definitions: [{ id: "f1", apiId: "body", type: "textarea" }],
      values: { f1: "Hello world" },
    });

    const summary = await applyEntryFieldEdits(tx as never, {
      entryId: "e1",
      contentTypeId: "ct1",
      fieldEdits: {
        body: [{ old_string: "world", new_string: "earth" }],
      },
      expectedHashes: { body: fieldDigest("Hello world").sha256 },
    });

    expect(summary.fields.body.sha256).toBe(fieldDigest("Hello earth").sha256);
  });
});
