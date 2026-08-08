import { prisma } from "../db.js";
import { httpError } from "./httpError.js";
import { verifyStoredPasswordHash } from "./passwordFields.js";

type FieldDef = {
  id: string;
  apiId: string;
  type: string;
};

async function loadContentTypeFields(contentTypeId: string) {
  return prisma.fieldDefinition.findMany({
    where: { contentTypeId },
    select: { id: true, apiId: true, type: true },
  });
}

function requirePasswordField(
  fields: FieldDef[],
  fieldApiId: string,
): FieldDef {
  const field = fields.find((f) => f.apiId === fieldApiId);
  if (!field || field.type !== "password") {
    throw httpError(
      404,
      `Password field "${fieldApiId}" not found on content type`,
      "PASSWORD_FIELD_NOT_FOUND",
    );
  }
  return field;
}

function requireUsernameField(
  fields: FieldDef[],
  fieldApiId: string,
): FieldDef {
  const field = fields.find((f) => f.apiId === fieldApiId);
  if (!field) {
    throw httpError(
      404,
      `Username field "${fieldApiId}" not found on content type`,
      "USERNAME_FIELD_NOT_FOUND",
    );
  }
  if (field.type === "password") {
    throw httpError(
      400,
      `Field "${fieldApiId}" is a password field; use a username/text field`,
      "VALIDATION_FAILED",
    );
  }
  return field;
}

async function loadFieldValue(entryId: string, fieldId: string) {
  const row = await prisma.entryFieldValue.findUnique({
    where: { entryId_fieldId: { entryId, fieldId } },
    select: { value: true },
  });
  return row?.value ?? null;
}

/**
 * Verify plaintext against a password field on an entry (draft or published).
 * Never returns the hash. Wrong password → 401 INVALID_CREDENTIALS.
 */
export async function verifyEntryPassword(input: {
  contentTypeId: string;
  entryId: string;
  password: string;
  fieldApiId: string;
}): Promise<{ ok: true; fieldApiId: string }> {
  const fields = await loadContentTypeFields(input.contentTypeId);
  const field = requirePasswordField(fields, input.fieldApiId);
  const stored = await loadFieldValue(input.entryId, field.id);
  const match = verifyStoredPasswordHash(input.password, stored);

  if (!match) {
    throw httpError(401, "Invalid password", "INVALID_CREDENTIALS");
  }

  return { ok: true as const, fieldApiId: input.fieldApiId };
}

/**
 * Look up entry by slug (+ locale) and verify username + password fields.
 * Wrong username or password → 401 INVALID_CREDENTIALS (no distinction).
 */
export async function verifyEntryCredentials(input: {
  contentTypeId: string;
  slug: string;
  locale: string;
  username: string;
  password: string;
  usernameFieldApiId: string;
  passwordFieldApiId: string;
}): Promise<{
  ok: true;
  entryId: string;
  slug: string;
  usernameFieldApiId: string;
  passwordFieldApiId: string;
}> {
  const fields = await loadContentTypeFields(input.contentTypeId);
  const usernameField = requireUsernameField(fields, input.usernameFieldApiId);
  const passwordField = requirePasswordField(fields, input.passwordFieldApiId);

  const entry = await prisma.entry.findUnique({
    where: {
      contentTypeId_slug_locale: {
        contentTypeId: input.contentTypeId,
        slug: input.slug,
        locale: input.locale,
      },
    },
    select: { id: true },
  });

  if (!entry) {
    // Same 401 as wrong password — avoid leaking whether the slug exists.
    throw httpError(401, "Invalid credentials", "INVALID_CREDENTIALS");
  }

  const [storedUsername, storedPassword] = await Promise.all([
    loadFieldValue(entry.id, usernameField.id),
    loadFieldValue(entry.id, passwordField.id),
  ]);

  const usernameOk =
    typeof storedUsername === "string" &&
    storedUsername === input.username;

  let passwordOk = false;
  try {
    passwordOk = verifyStoredPasswordHash(input.password, storedPassword);
  } catch (err) {
    const e = err as Error & { apiCode?: string };
    if (e.apiCode === "PASSWORD_NOT_SET") {
      // Treat unset password as failed login for slug-based flows
      // (caller already named a concrete account via slug).
      throw httpError(401, "Invalid credentials", "INVALID_CREDENTIALS");
    }
    throw err;
  }

  if (!usernameOk || !passwordOk) {
    throw httpError(401, "Invalid credentials", "INVALID_CREDENTIALS");
  }

  return {
    ok: true as const,
    entryId: entry.id,
    slug: input.slug,
    usernameFieldApiId: input.usernameFieldApiId,
    passwordFieldApiId: input.passwordFieldApiId,
  };
}
