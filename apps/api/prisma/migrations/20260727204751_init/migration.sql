-- CreateEnum
CREATE TYPE "EntryStatus" AS ENUM ('draft', 'published');

-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('text', 'textarea', 'richtext', 'boolean', 'datetime', 'number', 'slug', 'media');

-- CreateTable
CREATE TABLE "ContentType" (
    "id" TEXT NOT NULL,
    "apiId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldDefinition" (
    "id" TEXT NOT NULL,
    "contentTypeId" TEXT NOT NULL,
    "apiId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL,
    "contentTypeId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "EntryStatus" NOT NULL DEFAULT 'draft',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntryFieldValue" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "EntryFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentType_apiId_key" ON "ContentType"("apiId");

-- CreateIndex
CREATE INDEX "FieldDefinition_contentTypeId_sortOrder_idx" ON "FieldDefinition"("contentTypeId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "FieldDefinition_contentTypeId_apiId_key" ON "FieldDefinition"("contentTypeId", "apiId");

-- CreateIndex
CREATE INDEX "Entry_contentTypeId_status_idx" ON "Entry"("contentTypeId", "status");

-- CreateIndex
CREATE INDEX "Entry_contentTypeId_publishedAt_idx" ON "Entry"("contentTypeId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Entry_contentTypeId_slug_locale_key" ON "Entry"("contentTypeId", "slug", "locale");

-- CreateIndex
CREATE INDEX "EntryFieldValue_fieldId_idx" ON "EntryFieldValue"("fieldId");

-- CreateIndex
CREATE UNIQUE INDEX "EntryFieldValue_entryId_fieldId_key" ON "EntryFieldValue"("entryId", "fieldId");

-- AddForeignKey
ALTER TABLE "FieldDefinition" ADD CONSTRAINT "FieldDefinition_contentTypeId_fkey" FOREIGN KEY ("contentTypeId") REFERENCES "ContentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_contentTypeId_fkey" FOREIGN KEY ("contentTypeId") REFERENCES "ContentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryFieldValue" ADD CONSTRAINT "EntryFieldValue_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "Entry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryFieldValue" ADD CONSTRAINT "EntryFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "FieldDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
