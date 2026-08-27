-- CMS-59: persist last selected website for PAT / MCP HTTP bootstrap
ALTER TABLE "User" ADD COLUMN "lastSelectedWebsiteId" TEXT;

ALTER TABLE "User" ADD CONSTRAINT "User_lastSelectedWebsiteId_fkey" FOREIGN KEY ("lastSelectedWebsiteId") REFERENCES "Website"("id") ON DELETE SET NULL ON UPDATE CASCADE;
