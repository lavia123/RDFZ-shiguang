import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { configFromEnv } from "../src/server/config.js";

describe("identity mode fails closed", () => {
  const env = () => ({
    RDFZ_LESSON_ID: "l_test",
    RDFZ_APPLICATION_TOKEN: randomUUID(),
    RDFZ_OPUS_ROOT: "/tmp/test-opus",
    RDFZ_SCHOOL_DATA_ROOT: "/tmp/test-schools",
  });
  it("enables local identities only through the explicit development command", () => {
    expect(configFromEnv({}, []).identityMode).toBe("standalone");
    const config = configFromEnv({}, ["--local-dev"]);
    expect(config.identityMode).toBe("development");
    expect(config.dataDir.endsWith(".data-development")).toBe(true);
    expect(() =>
      configFromEnv({ NODE_ENV: "production" }, ["--local-dev"]),
    ).toThrow();
    expect(() => configFromEnv({}, ["--production", "--local-dev"])).toThrow();
  });
  it("requires every host setting and never falls back to test actors", () => {
    for (const key of Object.keys(env())) {
      const partial: NodeJS.ProcessEnv = env();
      delete partial[key];
      expect(() => configFromEnv(partial, [])).toThrow();
      expect(() => configFromEnv(partial, ["--local-dev"])).toThrow();
    }
    const config = configFromEnv(
      { ...env(), SHIGUANG_TEST_ACTORS: "1", SHIGUANG_DEV_ACTOR: "admin" },
      [],
    );
    expect(config.identityMode).toBe("platform");
    expect(config.testActors).toBe(false);
    expect(config.devActor).toBe("");
    expect(() => configFromEnv(env(), ["--local-dev"])).toThrow();
  });
});
