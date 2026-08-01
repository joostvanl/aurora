-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "siteKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_siteKey_key" ON "User"("siteKey");

-- Seed a migration owner for existing content (password reset by db:seed)
INSERT INTO "User" ("id", "email", "passwordHash", "name", "siteKey", "createdAt", "updatedAt")
VALUES (
  'migrate_demo_user',
  'demo@aurora.local',
  'migrate:placeholder',
  'Demo Editor',
  'demo-site-key',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- AlterTable ContentType
ALTER TABLE "ContentType" ADD COLUMN "userId" TEXT;

UPDATE "ContentType" SET "userId" = 'migrate_demo_user';

ALTER TABLE "ContentType" ALTER COLUMN "userId" SET NOT NULL;

DROP INDEX IF EXISTS "ContentType_apiId_key";

CREATE UNIQUE INDEX "ContentType_userId_apiId_key" ON "ContentType"("userId", "apiId");

ALTER TABLE "ContentType" ADD CONSTRAINT "ContentType_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rebuild Setting for per-user keys
ALTER TABLE "Setting" RENAME TO "Setting_old";
ALTER TABLE "Setting_old" RENAME CONSTRAINT "Setting_pkey" TO "Setting_old_pkey";

CREATE TABLE "Setting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Setting_userId_key_key" ON "Setting"("userId", "key");

ALTER TABLE "Setting" ADD CONSTRAINT "Setting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Setting" ("id", "userId", "key", "value", "updatedAt")
SELECT
  gen_random_uuid()::text,
  'migrate_demo_user',
  "key",
  "value",
  "updatedAt"
FROM "Setting_old";

DROP TABLE "Setting_old";
