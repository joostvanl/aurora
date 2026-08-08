import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../db.js", () => ({
  prisma: {
    fieldDefinition: { findMany: vi.fn() },
    entryFieldValue: { findUnique: vi.fn() },
    entry: { findUnique: vi.fn() },
  },
}));

import { prisma } from "../db.js";
import { hashPassword } from "../auth/password.js";
import {
  verifyEntryCredentials,
  verifyEntryPassword,
} from "./verifyEntryCredentials.js";

const fieldDefinitionFindMany = prisma.fieldDefinition.findMany as ReturnType<
  typeof vi.fn
>;
const entryFieldValueFindUnique = prisma.entryFieldValue
  .findUnique as ReturnType<typeof vi.fn>;
const entryFindUnique = prisma.entry.findUnique as ReturnType<typeof vi.fn>;

describe("verifyEntryPassword / verifyEntryCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = hashPassword("correct-horse");
    fieldDefinitionFindMany.mockResolvedValue([
      { id: "f1", apiId: "password", type: "password" },
    ]);
    entryFieldValueFindUnique.mockResolvedValue({ value: hash });

    await expect(
      verifyEntryPassword({
        contentTypeId: "ct1",
        entryId: "e1",
        password: "correct-horse",
        fieldApiId: "password",
      }),
    ).resolves.toEqual({ ok: true, fieldApiId: "password" });

    await expect(
      verifyEntryPassword({
        contentTypeId: "ct1",
        entryId: "e1",
        password: "wrong",
        fieldApiId: "password",
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      apiCode: "INVALID_CREDENTIALS",
    });
  });

  it("returns PASSWORD_NOT_SET when hash is missing", async () => {
    fieldDefinitionFindMany.mockResolvedValue([
      { id: "f1", apiId: "password", type: "password" },
    ]);
    entryFieldValueFindUnique.mockResolvedValue(null);

    await expect(
      verifyEntryPassword({
        contentTypeId: "ct1",
        entryId: "e1",
        password: "anything",
        fieldApiId: "password",
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      apiCode: "PASSWORD_NOT_SET",
    });
  });

  it("returns PASSWORD_FIELD_NOT_FOUND when field missing or wrong type", async () => {
    fieldDefinitionFindMany.mockResolvedValue([
      { id: "f1", apiId: "title", type: "text" },
    ]);

    await expect(
      verifyEntryPassword({
        contentTypeId: "ct1",
        entryId: "e1",
        password: "x",
        fieldApiId: "password",
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      apiCode: "PASSWORD_FIELD_NOT_FOUND",
    });
  });

  it("verifies username + password by slug", async () => {
    const hash = hashPassword("secret");
    fieldDefinitionFindMany.mockResolvedValue([
      { id: "fu", apiId: "username", type: "username" },
      { id: "fp", apiId: "password", type: "password" },
    ]);
    entryFindUnique.mockResolvedValue({ id: "e1" });
    entryFieldValueFindUnique.mockImplementation(
      async ({
        where: {
          entryId_fieldId: { fieldId },
        },
      }: {
        where: { entryId_fieldId: { fieldId: string } };
      }) => {
        if (fieldId === "fu") return { value: "admin" };
        if (fieldId === "fp") return { value: hash };
        return null;
      },
    );

    await expect(
      verifyEntryCredentials({
        contentTypeId: "ct1",
        slug: "default",
        locale: "en-US",
        username: "admin",
        password: "secret",
        usernameFieldApiId: "username",
        passwordFieldApiId: "password",
      }),
    ).resolves.toMatchObject({
      ok: true,
      entryId: "e1",
      slug: "default",
    });

    await expect(
      verifyEntryCredentials({
        contentTypeId: "ct1",
        slug: "default",
        locale: "en-US",
        username: "admin",
        password: "wrong",
        usernameFieldApiId: "username",
        passwordFieldApiId: "password",
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      apiCode: "INVALID_CREDENTIALS",
    });

    await expect(
      verifyEntryCredentials({
        contentTypeId: "ct1",
        slug: "default",
        locale: "en-US",
        username: "other",
        password: "secret",
        usernameFieldApiId: "username",
        passwordFieldApiId: "password",
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      apiCode: "INVALID_CREDENTIALS",
    });
  });

  it("returns 401 for unknown slug (no existence leak)", async () => {
    fieldDefinitionFindMany.mockResolvedValue([
      { id: "fu", apiId: "username", type: "username" },
      { id: "fp", apiId: "password", type: "password" },
    ]);
    entryFindUnique.mockResolvedValue(null);

    await expect(
      verifyEntryCredentials({
        contentTypeId: "ct1",
        slug: "missing",
        locale: "en-US",
        username: "admin",
        password: "secret",
        usernameFieldApiId: "username",
        passwordFieldApiId: "password",
      }),
    ).rejects.toMatchObject({
      statusCode: 401,
      apiCode: "INVALID_CREDENTIALS",
    });
  });
});
