-- Per-website browser origins for CORS (frontends for this tenant).
ALTER TABLE "Website" ADD COLUMN "allowedOrigins" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
