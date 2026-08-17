import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { asCreatedByUserId } from "./entries.js";
import { httpError } from "./httpError.js";
import type { ActorKind } from "./versions.js";

export type AuditEventDto = {
  id: string;
  websiteId: string;
  actorUserId: string | null;
  actorKind: string;
  action: string;
  resourceType: string;
  resourceId: string;
  summary: string;
  meta: unknown;
  createdAt: string;
  aiDetail: string | null;
  aiDetailActorKind: string | null;
  aiDetailCreatedAt: string | null;
  aiDetailSource: string | null;
};

export function serializeAuditEvent(row: {
  id: string;
  websiteId: string;
  actorUserId: string | null;
  actorKind: string;
  action: string;
  resourceType: string;
  resourceId: string;
  summary: string;
  meta: Prisma.JsonValue | null;
  createdAt: Date;
  aiDetail?: string | null;
  aiDetailActorKind?: string | null;
  aiDetailCreatedAt?: Date | null;
  aiDetailSource?: string | null;
}): AuditEventDto {
  return {
    id: row.id,
    websiteId: row.websiteId,
    actorUserId: row.actorUserId,
    actorKind: row.actorKind,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    summary: row.summary,
    meta: row.meta,
    createdAt: row.createdAt.toISOString(),
    aiDetail: row.aiDetail ?? null,
    aiDetailActorKind: row.aiDetailActorKind ?? null,
    aiDetailCreatedAt: row.aiDetailCreatedAt
      ? row.aiDetailCreatedAt.toISOString()
      : null,
    aiDetailSource: row.aiDetailSource ?? null,
  };
}

export async function recordAuditEvent(options: {
  websiteId: string;
  actorUserId?: string | null;
  actorKind?: ActorKind;
  action: string;
  resourceType: string;
  resourceId: string;
  summary: string;
  meta?: Record<string, unknown> | null;
}) {
  const actorUserId = asCreatedByUserId(options.actorUserId);
  const actorKind: ActorKind =
    options.actorKind ?? (actorUserId ? "user" : "system");

  const row = await prisma.auditEvent.create({
    data: {
      websiteId: options.websiteId,
      actorUserId,
      actorKind,
      action: options.action,
      resourceType: options.resourceType,
      resourceId: options.resourceId,
      summary: options.summary,
      meta:
        options.meta == null
          ? undefined
          : (options.meta as Prisma.InputJsonValue),
    },
  });
  return serializeAuditEvent(row);
}

export async function listAuditEvents(options: {
  websiteId: string;
  resourceType?: string;
  resourceId?: string;
  /** When true, only events that still lack an AI enrichment. */
  missingAiDetail?: boolean;
  limit?: number;
  offset?: number;
}) {
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 50)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const rows = await prisma.auditEvent.findMany({
    where: {
      websiteId: options.websiteId,
      ...(options.resourceType ? { resourceType: options.resourceType } : {}),
      ...(options.resourceId ? { resourceId: options.resourceId } : {}),
      ...(options.missingAiDetail ? { aiDetail: null } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });
  return rows.map(serializeAuditEvent);
}

/**
 * Append-only AI enrichment. Never mutates summary, action, actor fields, or createdAt.
 * Rejects when aiDetail is already set unless force=true (not exposed to AI tools).
 */
export async function annotateAuditEvent(options: {
  websiteId: string;
  auditEventId: string;
  detail: string;
  actorKind?: ActorKind;
  source?: string | null;
  force?: boolean;
}) {
  const detail = options.detail.trim();
  if (!detail) {
    throw httpError(400, "detail is required", "VALIDATION_FAILED");
  }

  const existing = await prisma.auditEvent.findFirst({
    where: { id: options.auditEventId, websiteId: options.websiteId },
  });
  if (!existing) {
    throw httpError(404, "Audit event not found", "NOT_FOUND");
  }

  if (existing.aiDetail != null && !options.force) {
    throw httpError(
      409,
      "Audit event already has an AI detail; enrichment is append-once unless force=true",
      "CONFLICT",
    );
  }

  const actorKind: ActorKind = options.actorKind ?? "ai";
  const row = await prisma.auditEvent.update({
    where: { id: existing.id },
    data: {
      aiDetail: detail,
      aiDetailActorKind: actorKind,
      aiDetailCreatedAt: new Date(),
      aiDetailSource: options.source ?? null,
    },
  });
  return serializeAuditEvent(row);
}
