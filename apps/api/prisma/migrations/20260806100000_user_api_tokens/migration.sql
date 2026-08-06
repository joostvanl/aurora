-- CreateTable
CREATE TABLE "UserApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserApiToken_tokenHash_key" ON "UserApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "UserApiToken_userId_idx" ON "UserApiToken"("userId");

-- AddForeignKey
ALTER TABLE "UserApiToken" ADD CONSTRAINT "UserApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
