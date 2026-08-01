-- CreateEnum
CREATE TYPE "LocalizationMode" AS ENUM ('explicit', 'all_locales');

-- AlterTable Website: site locales
ALTER TABLE "Website" ADD COLUMN "locales" TEXT[] DEFAULT ARRAY['en-US']::TEXT[];
ALTER TABLE "Website" ADD COLUMN "defaultLocale" TEXT NOT NULL DEFAULT 'en-US';

-- AlterTable ContentType: localization mode
ALTER TABLE "ContentType" ADD COLUMN "localizationMode" "LocalizationMode" NOT NULL DEFAULT 'explicit';

-- Migrate legacy Entry.locale "en" → "en-US" before changing default
UPDATE "Entry" SET "locale" = 'en-US' WHERE "locale" = 'en';

-- AlterTable Entry default locale
ALTER TABLE "Entry" ALTER COLUMN "locale" SET DEFAULT 'en-US';
