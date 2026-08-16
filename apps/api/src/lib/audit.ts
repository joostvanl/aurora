import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { asCreatedByUserId } from "./entries.js";
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
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset,
  });
  return rows.map(serializeAuditEvent);
}
