-- AlterTable AuditEvent: append-only AI enrichment fields (CMS-48)
ALTER TABLE "AuditEvent" ADD COLUMN "aiDetail" TEXT;
ALTER TABLE "AuditEvent" ADD COLUMN "aiDetailActorKind" TEXT;
ALTER TABLE "AuditEvent" ADD COLUMN "aiDetailCreatedAt" TIMESTAMP(3);
ALTER TABLE "AuditEvent" ADD COLUMN "aiDetailSource" TEXT;
