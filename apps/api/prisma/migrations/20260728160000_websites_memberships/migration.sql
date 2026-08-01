-- CreateEnum
CREATE TYPE "WebsiteRole" AS ENUM ('editor', 'builder', 'admin');

-- CreateTable Website
CREATE TABLE "Website" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "siteKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Website_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Website_siteKey_key" ON "Website"("siteKey");

-- CreateTable Membership
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "role" "WebsiteRole" NOT NULL DEFAULT 'editor',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Membership_userId_websiteId_key" ON "Membership"("userId", "websiteId");
CREATE INDEX "Membership_websiteId_idx" ON "Membership"("websiteId");

ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one Website per existing User (keep siteKey)
INSERT INTO "Website" ("id", "name", "siteKey", "createdAt", "updatedAt")
SELECT
  'ws_' || u."id",
  COALESCE(NULLIF(u."name", ''), split_part(u."email", '@', 1), 'Website'),
  u."siteKey",
  u."createdAt",
  u."updatedAt"
FROM "User" u;

INSERT INTO "Membership" ("id", "userId", "websiteId", "role", "createdAt", "updatedAt")
SELECT
  'mem_' || u."id",
  u."id",
  'ws_' || u."id",
  'admin'::"WebsiteRole",
  u."createdAt",
  u."updatedAt"
FROM "User" u;

-- ContentType: userId → websiteId
ALTER TABLE "ContentType" ADD COLUMN "websiteId" TEXT;

UPDATE "ContentType" ct
SET "websiteId" = 'ws_' || ct."userId";

ALTER TABLE "ContentType" ALTER COLUMN "websiteId" SET NOT NULL;

ALTER TABLE "ContentType" DROP CONSTRAINT "ContentType_userId_fkey";
DROP INDEX IF EXISTS "ContentType_userId_apiId_key";
ALTER TABLE "ContentType" DROP COLUMN "userId";

CREATE UNIQUE INDEX "ContentType_websiteId_apiId_key" ON "ContentType"("websiteId", "apiId");
ALTER TABLE "ContentType" ADD CONSTRAINT "ContentType_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Form: userId → websiteId
ALTER TABLE "Form" ADD COLUMN "websiteId" TEXT;

UPDATE "Form" f
SET "websiteId" = 'ws_' || f."userId";

ALTER TABLE "Form" ALTER COLUMN "websiteId" SET NOT NULL;

ALTER TABLE "Form" DROP CONSTRAINT "Form_userId_fkey";
DROP INDEX IF EXISTS "Form_userId_apiId_key";
ALTER TABLE "Form" DROP COLUMN "userId";

CREATE UNIQUE INDEX "Form_websiteId_apiId_key" ON "Form"("websiteId", "apiId");
ALTER TABLE "Form" ADD CONSTRAINT "Form_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Setting: userId → websiteId
ALTER TABLE "Setting" ADD COLUMN "websiteId" TEXT;

UPDATE "Setting" s
SET "websiteId" = 'ws_' || s."userId";

ALTER TABLE "Setting" ALTER COLUMN "websiteId" SET NOT NULL;

ALTER TABLE "Setting" DROP CONSTRAINT "Setting_userId_fkey";
DROP INDEX IF EXISTS "Setting_userId_key_key";
ALTER TABLE "Setting" DROP COLUMN "userId";

CREATE UNIQUE INDEX "Setting_websiteId_key_key" ON "Setting"("websiteId", "key");
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ApiToken: userId → websiteId
ALTER TABLE "ApiToken" ADD COLUMN "websiteId" TEXT;
ALTER TABLE "ApiToken" ADD COLUMN "createdById" TEXT;

UPDATE "ApiToken" t
SET "websiteId" = 'ws_' || t."userId",
    "createdById" = t."userId";

ALTER TABLE "ApiToken" ALTER COLUMN "websiteId" SET NOT NULL;

ALTER TABLE "ApiToken" DROP CONSTRAINT "ApiToken_userId_fkey";
DROP INDEX IF EXISTS "ApiToken_userId_idx";
ALTER TABLE "ApiToken" DROP COLUMN "userId";

CREATE INDEX "ApiToken_websiteId_idx" ON "ApiToken"("websiteId");
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- User no longer owns siteKey
DROP INDEX IF EXISTS "User_siteKey_key";
ALTER TABLE "User" DROP COLUMN "siteKey";
