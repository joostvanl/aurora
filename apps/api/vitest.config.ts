import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      CMS_JWT_SECRET:
        process.env.CMS_JWT_SECRET || "cms-59-test-jwt-secret-do-not-use",
    },
  },
});
