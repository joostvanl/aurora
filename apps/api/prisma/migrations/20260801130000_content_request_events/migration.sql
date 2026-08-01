-- CreateTable
CREATE TABLE "ContentRequestEvent" (
    "id" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "contentTypeApiId" TEXT NOT NULL,
    "entrySlug" TEXT,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentRequestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentRequestEvent_websiteId_createdAt_idx" ON "ContentRequestEvent"("websiteId", "createdAt");

-- AddForeignKey
ALTER TABLE "ContentRequestEvent" ADD CONSTRAINT "ContentRequestEvent_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
