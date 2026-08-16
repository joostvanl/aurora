-- AlterTable EntryVersion: actor metadata
ALTER TABLE "EntryVersion" ADD COLUMN "createdByUserId" TEXT;
ALTER TABLE "EntryVersion" ADD COLUMN "actorKind" TEXT;
ALTER TABLE "EntryVersion" ADD COLUMN "changeSummary" TEXT;

-- CreateTable ContentTypeVersion
CREATE TABLE "ContentTypeVersion" (
    "id" TEXT NOT NULL,
    "contentTypeId" TEXT NOT NULL,
    "label" TEXT,
    "source" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "actorKind" TEXT,
    "changeSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentTypeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable AuditEvent
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorKind" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntryVersion_createdByUserId_idx" ON "EntryVersion"("createdByUserId");
CREATE INDEX "ContentTypeVersion_contentTypeId_createdAt_idx" ON "ContentTypeVersion"("contentTypeId", "createdAt");
CREATE INDEX "ContentTypeVersion_createdByUserId_idx" ON "ContentTypeVersion"("createdByUserId");
CREATE INDEX "AuditEvent_websiteId_createdAt_idx" ON "AuditEvent"("websiteId", "createdAt");
CREATE INDEX "AuditEvent_resourceType_resourceId_createdAt_idx" ON "AuditEvent"("resourceType", "resourceId", "createdAt");
CREATE INDEX "AuditEvent_actorUserId_idx" ON "AuditEvent"("actorUserId");

-- AddForeignKey
ALTER TABLE "EntryVersion" ADD CONSTRAINT "EntryVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContentTypeVersion" ADD CONSTRAINT "ContentTypeVersion_contentTypeId_fkey" FOREIGN KEY ("contentTypeId") REFERENCES "ContentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentTypeVersion" ADD CONSTRAINT "ContentTypeVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
