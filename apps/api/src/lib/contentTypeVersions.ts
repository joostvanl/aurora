import type { FieldType, LocalizationMode, Prisma } from "@prisma/client";
import { Prisma as PrismaNS } from "@prisma/client";
import { prisma } from "../db.js";
import { asCreatedByUserId } from "./entries.js";
import { settingsToJson } from "./fieldSettings.js";
import { httpError } from "./httpError.js";
import { serializeContentType } from "./serialize.js";
import {
  clampVersionLimit,
  resolveActorKind,
  type ActorKind,
} from "./versions.js";

export type ContentTypeFieldSnapshot = {
  apiId: string;
  name: string;
  type: string;
  required: boolean;
  sortOrder: number;
  settings: unknown;
};

export type ContentTypeSnapshot = {
  apiId: string;
  name: string;
  description: string | null;
  localizationMode: string;
  fields: ContentTypeFieldSnapshot[];
};

export type ContentTypeVersionDto = {
  id: string;
  contentTypeId: string;
  label: string | null;
  source: string;
  snapshot: ContentTypeSnapshot;
  createdByUserId: string | null;
  actorKind: string | null;
  changeSummary: string | null;
  createdAt: string;
};

type ContentTypeWithFields = {
  id: string;
  apiId: string;
  name: string;
  description: string | null;
  localizationMode: LocalizationMode;
  fields: Array<{
    apiId: string;
    name: string;
    type: FieldType;
    required: boolean;
    sortOrder: number;
    settings: Prisma.JsonValue | null;
  }>;
};

export function toContentTypeSnapshot(ct: ContentTypeWithFields): ContentTypeSnapshot {
  return {
    apiId: ct.apiId,
    name: ct.name,
    description: ct.description,
    localizationMode: ct.localizationMode,
    fields: ct.fields
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((f) => ({
        apiId: f.apiId,
        name: f.name,
        type: f.type,
        required: f.required,
        sortOrder: f.sortOrder,
        settings: f.settings ?? null,
      })),
  };
}

export function serializeContentTypeVersion(row: {
  id: string;
  contentTypeId: string;
  label: string | null;
  source: string;
  snapshot: Prisma.JsonValue;
  createdByUserId?: string | null;
  actorKind?: string | null;
  changeSummary?: string | null;
  createdAt: Date;
}): ContentTypeVersionDto {
  return {
    id: row.id,
    contentTypeId: row.contentTypeId,
    label: row.label,
    source: row.source,
    snapshot: row.snapshot as ContentTypeSnapshot,
    createdByUserId: row.createdByUserId ?? null,
    actorKind: row.actorKind ?? null,
    changeSummary: row.changeSummary ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadContentType(contentTypeId: string) {
  return prisma.contentType.findUniqueOrThrow({
    where: { id: contentTypeId },
    include: { fields: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function createContentTypeVersion(options: {
  contentTypeId: string;
  label?: string;
  source: string;
  createdByUserId?: string | null;
  actorKind?: ActorKind;
  changeSummary?: string;
}) {
  const createdByUserId = asCreatedByUserId(options.createdByUserId);
  const actorKind = resolveActorKind({
    actorKind: options.actorKind,
    source: options.source,
    createdByUserId,
  });
  const ct = await loadContentType(options.contentTypeId);
  const version = await prisma.contentTypeVersion.create({
    data: {
      contentTypeId: ct.id,
      label: options.label,
      source: options.source,
      snapshot: toContentTypeSnapshot(ct) as Prisma.InputJsonValue,
      createdByUserId,
      actorKind,
      changeSummary: options.changeSummary,
    },
  });
  return serializeContentTypeVersion(version);
}

export async function listContentTypeVersions(
  contentTypeId: string,
  options?: { limit?: number; offset?: number },
) {
  const limit = clampVersionLimit(options?.limit);
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  const rows = await prisma.contentTypeVersion.findMany({
    where: { contentTypeId },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });
  return rows.map(serializeContentTypeVersion);
}

const FIELD_TYPES = new Set<string>([
  "text",
  "textarea",
  "richtext",
  "boolean",
  "datetime",
  "number",
  "slug",
  "media",
  "relation",
  "relations",
  "username",
  "password",
]);

function assertSnapshot(snapshot: ContentTypeSnapshot) {
  if (!snapshot?.apiId || !snapshot?.name || !Array.isArray(snapshot.fields)) {
    throw httpError(400, "Invalid content type snapshot", "VALIDATION_FAILED");
  }
  for (const field of snapshot.fields) {
    if (!field.apiId || !FIELD_TYPES.has(field.type)) {
      throw httpError(
        400,
        `Invalid field in snapshot: ${field.apiId ?? "(missing)"}`,
        "VALIDATION_FAILED",
      );
    }
  }
}

/**
 * Restore schema+fields from a snapshot.
 * Blocks when an existing field would change type while entry values exist.
 */
export async function restoreContentTypeVersion(options: {
  contentTypeId: string;
  versionId: string;
  createdByUserId?: string | null;
}) {
  const version = await prisma.contentTypeVersion.findFirst({
    where: { id: options.versionId, contentTypeId: options.contentTypeId },
  });
  if (!version) throw httpError(404, "Version not found");

  await createContentTypeVersion({
    contentTypeId: options.contentTypeId,
    label: "Before restore",
    source: "restore",
    createdByUserId: options.createdByUserId,
  });

  const snapshot = version.snapshot as ContentTypeSnapshot;
  assertSnapshot(snapshot);

  const current = await loadContentType(options.contentTypeId);
  const currentByApiId = new Map(current.fields.map((f) => [f.apiId, f]));
  const targetApiIds = new Set(snapshot.fields.map((f) => f.apiId));

  for (const field of snapshot.fields) {
    const existing = currentByApiId.get(field.apiId);
    if (existing && existing.type !== field.type) {
      const valueCount = await prisma.entryFieldValue.count({
        where: { fieldId: existing.id },
      });
      if (valueCount > 0) {
        throw httpError(
          409,
          `Cannot restore: field "${field.apiId}" type would change from ${existing.type} to ${field.type} while ${valueCount} value(s) exist`,
          "CONFLICT",
        );
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.contentType.update({
      where: { id: options.contentTypeId },
      data: {
        name: snapshot.name,
        description: snapshot.description,
        localizationMode:
          snapshot.localizationMode === "all_locales" ? "all_locales" : "explicit",
      },
    });

    for (const existing of current.fields) {
      if (!targetApiIds.has(existing.apiId)) {
        await tx.fieldDefinition.delete({ where: { id: existing.id } });
      }
    }

    for (const field of snapshot.fields) {
      const settingsJson = settingsToJson(
        (field.settings as Record<string, unknown> | null) ?? null,
      );
      const existing = currentByApiId.get(field.apiId);
      if (existing) {
        await tx.fieldDefinition.update({
          where: { id: existing.id },
          data: {
            name: field.name,
            type: field.type as FieldType,
            required: field.required,
            sortOrder: field.sortOrder,
            ...(settingsJson !== undefined
              ? {
                  settings:
                    settingsJson === PrismaNS.JsonNull
                      ? PrismaNS.JsonNull
                      : settingsJson,
                }
              : { settings: PrismaNS.JsonNull }),
          },
        });
      } else {
        await tx.fieldDefinition.create({
          data: {
            contentTypeId: options.contentTypeId,
            apiId: field.apiId,
            name: field.name,
            type: field.type as FieldType,
            required: field.required,
            sortOrder: field.sortOrder,
            ...(settingsJson !== undefined
              ? {
                  settings:
                    settingsJson === PrismaNS.JsonNull
                      ? PrismaNS.JsonNull
                      : settingsJson,
                }
              : {}),
          },
        });
      }
    }
  });

  const updated = await loadContentType(options.contentTypeId);
  return {
    contentType: serializeContentType(updated),
    restoredFrom: serializeContentTypeVersion(version),
  };
}

/**
 * One pre-mutation schema snapshot per content type for a single request (AI or auto).
 * Prevents double-versioning when AI tools batch multiple field/type edits in one turn.
 */
export function createContentTypeSnapshotGuard(
  defaultSource: "ai" | "auto" = "ai",
) {
  const snapped = new Set<string>();

  return async function ensureSnapshot(
    contentTypeId: string,
    options?: {
      label?: string;
      source?: string;
      createdByUserId?: string | null;
      actorKind?: ActorKind;
      changeSummary?: string;
    },
  ) {
    if (snapped.has(contentTypeId)) return null;
    snapped.add(contentTypeId);
    return createContentTypeVersion({
      contentTypeId,
      label:
        options?.label ??
        (defaultSource === "ai" ? "Before AI edit" : undefined),
      source: options?.source ?? defaultSource,
      createdByUserId: options?.createdByUserId,
      actorKind: options?.actorKind,
      changeSummary: options?.changeSummary,
    });
  };
}

/** Ensure one schema snapshot per content type for a single AI turn. */
export function createAiContentTypeSnapshotGuard() {
  const ensure = createContentTypeSnapshotGuard("ai");
  return async function ensureAiContentTypeSnapshot(
    contentTypeId: string,
    options?: {
      label?: string;
      changeSummary?: string;
      createdByUserId?: string | null;
    },
  ) {
    return ensure(contentTypeId, {
      label: options?.label ?? "Before AI edit",
      source: "ai",
      actorKind: "ai",
      changeSummary: options?.changeSummary,
      createdByUserId: options?.createdByUserId,
    });
  };
}
