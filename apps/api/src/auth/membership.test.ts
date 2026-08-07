import { describe, expect, it } from "vitest";
import { applyLiveMembership } from "./membership.js";
import type { AuthUser } from "./password.js";

describe("applyLiveMembership", () => {
  it("overwrites stale JWT role and website metadata", () => {
    const user: AuthUser = {
      id: "user_1",
      email: "a@example.com",
      name: "A",
      websiteId: "site_old",
      websiteName: "Old",
      role: "admin",
      siteKey: "old-key",
    };

    applyLiveMembership(user, {
      role: "editor",
      websiteId: "site_1",
      websiteName: "Live Site",
      siteKey: "live-key",
    });

    expect(user.role).toBe("editor");
    expect(user.websiteId).toBe("site_1");
    expect(user.websiteName).toBe("Live Site");
    expect(user.siteKey).toBe("live-key");
  });
});
