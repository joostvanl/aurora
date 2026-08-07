import { describe, expect, it } from "vitest";
import type { ContentType, Entry, EntryFieldValue, FieldDefinition } from "@prisma/client";
import { serializeEntry } from "./serialize.js";
import { hashPassword } from "../auth/password.js";

function fakeEntry(
  fieldValues: Array<{ apiId: string; type: FieldDefinition["type"]; value: unknown }>,
) {
  const contentType = {
    id: "ct1",
    websiteId: "w1",
    apiId: "account",
    name: "Account",
    description: null,
    localizationMode: "explicit",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  } as ContentType;

  return {
    id: "e1",
    contentTypeId: "ct1",
    slug: "alice",
    status: "published",
    locale: "en-US",
    createdByUserId: null,
    publishedAt: new Date("2026-01-01"),
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    contentType,
    createdBy: null,
    fieldValues: fieldValues.map((fv, i) => ({
      id: `fv${i}`,
      entryId: "e1",
      fieldId: `f${i}`,
      value: fv.value as EntryFieldValue["value"],
      field: {
        id: `f${i}`,
        contentTypeId: "ct1",
        apiId: fv.apiId,
        name: fv.apiId,
        type: fv.type,
        required: false,
        sortOrder: i,
        settings: null,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
      } as FieldDefinition,
    })),
  } as Entry & {
    contentType: ContentType;
    fieldValues: Array<EntryFieldValue & { field: FieldDefinition }>;
    createdBy: null;
  };
}

describe("serializeEntry password redaction", () => {
  it("never returns the raw hash", () => {
    const hash = hashPassword("super-secret");
    const entry = fakeEntry([
      { apiId: "username", type: "username", value: "alice" },
      { apiId: "password", type: "password", value: hash },
    ]);
    const flat = serializeEntry(entry);
    expect(flat.fields.username).toBe("alice");
    expect(flat.fields.password).toEqual({ set: true });
    expect(JSON.stringify(flat)).not.toContain(hash);
    expect(JSON.stringify(flat)).not.toContain("super-secret");
  });

  it("returns null when password unset", () => {
    const entry = fakeEntry([
      { apiId: "password", type: "password", value: null },
    ]);
    expect(serializeEntry(entry).fields.password).toBeNull();
  });
});
