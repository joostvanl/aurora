import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { entryInclude, setEntryFields } from "../lib/entries.js";
import { serializeEntry } from "../lib/serialize.js";

export type EntrySnapshot = {
  slug: string;
  status: string;
  locale: string;
  fields: Record<string, unknown>;
};

export type EntryVersionDto = {
  id: string;
  entryId: string;
  label: string | null;
  source: string;
  snapshot: EntrySnapshot;
  createdAt: string;
};

function toSnapshot(entry: {
  slug: string;
  status: string;
  locale: string;
  fieldValues: Array<{ value: Prisma.JsonValue; field: { apiId: string } }>;
}): EntrySnapshot {
  const fields: Record<string, unknown> = {};
  for (const fv of entry.fieldValues) {
    fields[fv.field.apiId] = fv.value;
  }
  return {
    slug: entry.slug,
    status: entry.status,
    locale: entry.locale,
    fields,
  };
}

export function serializeVersion(row: {
  id: string;
  entryId: string;
  label: string | null;
  source: string;
  snapshot: Prisma.JsonValue;
  createdAt: Date;
}): EntryVersionDto {
  return {
    id: row.id,
    entryId: row.entryId,
    label: row.label,
    source: row.source,
    snapshot: row.snapshot as EntrySnapshot,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createEntryVersion(options: {
  entryId: string;
  label?: string;
  source: string;
}) {
  const entry = await prisma.entry.findUniqueOrThrow({
    where: { id: options.entryId },
    include: {
      fieldValues: { include: { field: true } },
    },
  });

  const version = await prisma.entryVersion.create({
    data: {
      entryId: entry.id,
      label: options.label,
      source: options.source,
      snapshot: toSnapshot(entry) as Prisma.InputJsonValue,
    },
  });

  return serializeVersion(version);
}

export async function listEntryVersions(entryId: string, limit = 30) {
  const rows = await prisma.entryVersion.findMany({
    where: { entryId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(serializeVersion);
}

export async function restoreEntryVersion(options: {
  contentTypeId: string;
  entryId: string;
  versionId: string;
}) {
  const version = await prisma.entryVersion.findFirst({
    where: { id: options.versionId, entryId: options.entryId },
  });
  if (!version) {
    throw Object.assign(new Error("Version not found"), { statusCode: 404 });
  }

  // Snapshot current state before restore (so undo is itself undoable).
  await createEntryVersion({
    entryId: options.entryId,
    label: "Before restore",
    source: "restore",
  });

  const snapshot = version.snapshot as EntrySnapshot;

  await prisma.entry.update({
    where: { id: options.entryId },
    data: {
      slug: snapshot.slug,
      locale: snapshot.locale,
      status: snapshot.status as "draft" | "published",
      publishedAt:
        snapshot.status === "published"
          ? new Date()
          : null,
    },
  });

  await setEntryFields(options.entryId, options.contentTypeId, snapshot.fields);

  const full = await prisma.entry.findUniqueOrThrow({
    where: { id: options.entryId },
    include: entryInclude,
  });

  return {
    entry: serializeEntry(full),
    restoredFrom: serializeVersion(version),
  };
}

/** Ensure one pre-mutation snapshot per entry for a single AI turn. */
export function createAiSnapshotGuard() {
  const snapped = new Set<string>();

  return async function ensureAiSnapshot(
    entryId: string,
    label = "Before AI edit",
  ) {
    if (snapped.has(entryId)) return null;
    snapped.add(entryId);
    return createEntryVersion({
      entryId,
      label,
      source: "ai",
    });
  };
}
