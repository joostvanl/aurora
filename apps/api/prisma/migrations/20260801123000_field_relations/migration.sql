-- AlterEnum
ALTER TYPE "FieldType" ADD VALUE 'relation';
ALTER TYPE "FieldType" ADD VALUE 'relations';

-- AlterTable
ALTER TABLE "FieldDefinition" ADD COLUMN "settings" JSONB;
