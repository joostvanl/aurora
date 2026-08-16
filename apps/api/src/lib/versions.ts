import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { asCreatedByUserId, entryInclude, setEntryFields } from "../lib/entries.js";
import { serializeEntry } from "../lib/serialize.js";
import { httpError } from "./httpError.js";

export type ActorKind = "user" | "ai" | "system";

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
  createdByUserId: string | null;
  actorKind: string | null;
  changeSummary: string | null;
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
  createdByUserId?: string | null;
  actorKind?: string | null;
  changeSummary?: string | null;
  createdAt: Date;
}): EntryVersionDto {
  return {
    id: row.id,
    entryId: row.entryId,
    label: row.label,
    source: row.source,
    snapshot: row.snapshot as EntrySnapshot,
    createdByUserId: row.createdByUserId ?? null,
    actorKind: row.actorKind ?? null,
    changeSummary: row.changeSummary ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function resolveActorKind(options: {
  actorKind?: ActorKind;
  source: string;
  createdByUserId?: string | null;
}): ActorKind {
  if (options.actorKind) return options.actorKind;
  if (options.source === "ai") return "ai";
  if (options.createdByUserId) return "user";
  return "system";
}

export async function createEntryVersion(options: {
  entryId: string;
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
      createdByUserId,
      actorKind,
      changeSummary: options.changeSummary,
    },
  });

  return serializeVersion(version);
}

export function clampVersionLimit(limit?: number, fallback = 50) {
  const n = limit == null || Number.isNaN(limit) ? fallback : Math.floor(limit);
  return Math.min(100, Math.max(1, n));
}

export async function listEntryVersions(
  entryId: string,
  options?: { limit?: number; offset?: number },
) {
  const limit = clampVersionLimit(options?.limit);
  const offset = Math.max(0, Math.floor(options?.offset ?? 0));
  const rows = await prisma.entryVersion.findMany({
    where: { entryId },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });
  return rows.map(serializeVersion);
}

export async function restoreEntryVersion(options: {
  contentTypeId: string;
  entryId: string;
  versionId: string;
  createdByUserId?: string | null;
}) {
  const version = await prisma.entryVersion.findFirst({
    where: { id: options.versionId, entryId: options.entryId },
  });
  if (!version) {
    throw httpError(404, "Version not found");
  }

  // Snapshot current state before restore (so undo is itself undoable).
  await createEntryVersion({
    entryId: options.entryId,
    label: "Before restore",
    source: "restore",
    createdByUserId: options.createdByUserId,
    actorKind: options.createdByUserId ? "user" : "system",
  });

  const snapshot = version.snapshot as EntrySnapshot;

  await prisma.entry.update({
    where: { id: options.entryId },
    data: {
      slug: snapshot.slug,
      locale: snapshot.locale,
      status: snapshot.status as "draft" | "published",
      publishedAt: snapshot.status === "published" ? new Date() : null,
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

/**
 * One pre-mutation snapshot per entry for a single request (AI or auto).
 * Prevents double-versioning when AI tools and auto-version share a turn.
 */
export function createSnapshotGuard(defaultSource: "ai" | "auto" = "ai") {
  const snapped = new Set<string>();

  return async function ensureSnapshot(
    entryId: string,
    options?: {
      label?: string;
      source?: string;
      createdByUserId?: string | null;
      actorKind?: ActorKind;
      changeSummary?: string;
    },
  ) {
    if (snapped.has(entryId)) return null;
    snapped.add(entryId);
    return createEntryVersion({
      entryId,
      label:
        options?.label ??
        (defaultSource === "ai" ? "Before AI edit" : "Auto checkpoint"),
      source: options?.source ?? defaultSource,
      createdByUserId: options?.createdByUserId,
      actorKind: options?.actorKind,
      changeSummary: options?.changeSummary,
    });
  };
}

/** Ensure one pre-mutation snapshot per entry for a single AI turn. */
export function createAiSnapshotGuard() {
  const ensure = createSnapshotGuard("ai");
  return async function ensureAiSnapshot(
    entryId: string,
    label = "Before AI edit",
  ) {
    return ensure(entryId, { label, source: "ai", actorKind: "ai" });
  };
}
