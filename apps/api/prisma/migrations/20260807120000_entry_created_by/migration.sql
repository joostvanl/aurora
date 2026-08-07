-- AlterTable
ALTER TABLE "Entry" ADD COLUMN "createdByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Entry_createdByUserId_idx" ON "Entry"("createdByUserId");

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
