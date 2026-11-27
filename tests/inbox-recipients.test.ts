import { describe, expect, it } from "vitest";
import { adminRecipientIds } from "../src/server/inbox.js";
import { SCHOOL_ADMIN_MAILBOX } from "../src/shared/messages.js";
import type { Config } from "../src/server/config.js";

function base(partial: Partial<Config> = {}): Config {
  return {
    root: "/tmp",
    dataDir: "/tmp",
    port: 0,
    adminPin: "",
    tokenSecret: "test-signing-secret-32-characters-long",
    aiKey: "",
    production: true,
    identityMode: "platform",
    testActors: false,
    testReviewAllow: false,
    devActor: "",
    ...partial,
  };
}

describe("adminRecipientIds", () => {
  it("always includes the school admin mailbox on platform", () => {
    const ids = adminRecipientIds(base());
    expect(ids).toEqual([SCHOOL_ADMIN_MAILBOX]);
  });

  it("keeps local development admins in addition to the shared mailbox", () => {
    const ids = adminRecipientIds(
      base({
        production: false,
        identityMode: "development",
        testActors: false,
      }),
    );
    expect(ids).toContain(SCHOOL_ADMIN_MAILBOX);
    expect(ids.length).toBeGreaterThan(1);
  });
});
