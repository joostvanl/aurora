-- CreateTable
CREATE TABLE "EntryVersion" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "label" TEXT,
    "source" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntryVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntryVersion_entryId_createdAt_idx" ON "EntryVersion"("entryId", "createdAt");

-- AddForeignKey
ALTER TABLE "EntryVersion" ADD CONSTRAINT "EntryVersion_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
