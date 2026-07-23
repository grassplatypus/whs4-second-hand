import { describe, it, expect } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://u:p@db:5432/app",
  JWT_ACCESS_SECRET: "a".repeat(32),
  AES_KEY: "c".repeat(32),
  BLIND_INDEX_KEY: "d".repeat(32),
  WS_PORT: "4000",
  OAUTH_STATE_SECRET: "test_oauth_state_secret_min16",
  NODE_ENV: "test",
};

describe("parseEnv", () => {
  it("parses valid env and coerces WS_PORT to number", () => {
    const env = parseEnv(valid);
    expect(env.WS_PORT).toBe(4000);
    expect(env.DATABASE_URL).toContain("postgresql://");
  });

  it("throws when a required var is missing", () => {
    const { DATABASE_URL, ...rest } = valid;
    expect(() => parseEnv(rest)).toThrow();
  });

  it("throws when AES_KEY is not 32 chars", () => {
    expect(() => parseEnv({ ...valid, AES_KEY: "short" })).toThrow();
  });

  it("rejects AES_KEY with 32 chars but >32 bytes (Korean syllables)", () => {
    // 32 Korean syllables, each 3 bytes in UTF-8 = 96 bytes total
    const koreanKey = "가".repeat(32);
    expect(() => parseEnv({ ...valid, AES_KEY: koreanKey })).toThrow();
  });

  it("accepts AES_KEY with exactly 32 bytes (ASCII)", () => {
    // 32 ASCII chars = 32 bytes in UTF-8
    const asciiKey = "a".repeat(32);
    const env = parseEnv({ ...valid, AES_KEY: asciiKey });
    expect(env.AES_KEY).toBe(asciiKey);
  });

  it("rejects BLIND_INDEX_KEY under 32 bytes (Korean syllables)", () => {
    // 10 Korean syllables = 30 bytes (3 bytes/syllable in UTF-8), which is < the 32-byte minimum.
    const koreanKey = "가".repeat(10); // 30 bytes
    expect(() => parseEnv({ ...valid, BLIND_INDEX_KEY: koreanKey })).toThrow();
  });

  it("accepts BLIND_INDEX_KEY with at least 32 bytes", () => {
    // 32 ASCII chars = 32 bytes in UTF-8
    const asciiKey = "d".repeat(32);
    const env = parseEnv({ ...valid, BLIND_INDEX_KEY: asciiKey });
    expect(env.BLIND_INDEX_KEY).toBe(asciiKey);
  });
});
