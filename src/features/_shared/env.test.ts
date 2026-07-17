import { describe, it, expect } from "vitest";
import { parseEnv } from "./env";

const valid = {
  DATABASE_URL: "postgresql://u:p@db:5432/app",
  JWT_ACCESS_SECRET: "a".repeat(32),
  JWT_REFRESH_SECRET: "b".repeat(32),
  AES_KEY: "c".repeat(32),
  WS_PORT: "4000",
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
});
